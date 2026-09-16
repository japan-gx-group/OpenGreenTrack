// exceljs のストリーミング読取（WorkbookReader）へ xlsx を安全に流すための入力ストリーム生成。
//
// 背景（exceljs 4.4 の WorkbookReader の挙動。IDEA 取込のストリーミング化で判明）:
//   WorkbookReader は内部で unzipper の Parse に入力を pipe し、ZIP エントリを非同期イテレータで
//   1 件ずつ取り出す。イテレータは Parse の 'end' を「エントリはもう無い」の合図にしているが、
//   Parse は終端レコード（End of Central Directory）を読んだ時点で end する一方、**小さなエントリ
//   （数十 KB 未満）は誰にも読まれないまま次のエントリへ進める**。そのため ZIP の末尾付近に小さな
//   エントリが並ぶと、それらがイテレータへ届く前に 'end' が来て取りこぼされる。Excel も exceljs も
//   `xl/workbook.xml`（シート名の正本）や `xl/styles.xml` を末尾側に書くため、シート名が解決されず
//   取込が失敗する（タイミング依存で再現したりしなかったりする）。
//
// 対処: ZIP の中央ディレクトリの直前に、**大きな詰め物エントリ（無圧縮 1MiB）を 1 件追加**した
//   ストリームを作って渡す。大きなエントリは消費されるまで Parse が先へ進めない（PassThrough の
//   バックプレッシャ）ため、詰め物が消費される＝それより前の全エントリがイテレータへ届いた後で
//   'end' が来るようになる。既存エントリのバイト列（ローカルヘッダ・圧縮データ・中央ディレクトリの
//   各レコード）はそのまま流し、追加するのは詰め物のローカルヘッダ / 中央ディレクトリレコードと
//   新しい終端レコードだけ（元ファイルは書き換えない。ZIP のフォーマット仕様 APPNOTE 4.3 準拠）。
//
// 純関数（Buffer → Buffer[]）として書き、ストリームへの包み込みは createXlsxStreamSource が行う。

import { Readable } from 'node:stream';
import { crc32, inflateRawSync } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
/** 終端レコードの固定長（コメント除く）。コメントは最大 65535 バイトなので探索範囲はその分まで */
const EOCD_MIN_LENGTH = 22;
const EOCD_MAX_COMMENT_LENGTH = 0xffff;

/** 詰め物エントリ名（WorkbookReader は既知パス以外のエントリを読み飛ばす） */
export const ZIP_PADDING_ENTRY_NAME = 'opengreentrack-stream-padding.bin';
/**
 * 詰め物の大きさ。PassThrough の highWaterMark（Node 22 以降 64KiB）を十分に超え、
 * 「消費されるまで Parse が先へ進めない」状態を確実に作る。
 */
export const ZIP_PADDING_BYTES = 1024 * 1024;

/**
 * ストリームへ流すチャンクの上限。unzipper は受け取ったチャンクを内部バッファへ連結（コピー）して
 * 消費した分だけ切り詰めるため、ファイル丸ごとを 1 チャンクで渡すと、xlsx のコピーがもう 1 つ
 * 読み取りの間ずっと残る。小さく切って渡せば、コピーは常にこの大きさまでに収まる。
 */
export const STREAM_CHUNK_BYTES = 256 * 1024;

/** 終端レコード（EOCD）の主要フィールド */
export interface ZipCentralDirectoryInfo {
  entryCount: number;
  centralDirectoryOffset: number;
  centralDirectorySize: number;
}

/**
 * ZIP の終端レコードを末尾から探して中央ディレクトリの位置を返す。
 * ZIP でない・ZIP64（サイズや件数が 0xFFFF / 0xFFFFFFFF）・位置が不整合なら throw する
 * （xlsx は 50MB 以下・エントリ数十件なので ZIP64 にはならない）。
 */
export const readZipCentralDirectory = (buffer: Buffer): ZipCentralDirectoryInfo => {
  if (buffer.byteLength < EOCD_MIN_LENGTH) {
    throw new Error('ZIP ではありません（終端レコードがありません）');
  }
  const searchStart = Math.max(0, buffer.byteLength - EOCD_MIN_LENGTH - EOCD_MAX_COMMENT_LENGTH);
  let eocdOffset = -1;
  for (let offset = buffer.byteLength - EOCD_MIN_LENGTH; offset >= searchStart; offset--) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('ZIP ではありません（終端レコードが見つかりません）');
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    throw new Error('ZIP64 形式には対応していません');
  }
  if (
    centralDirectoryOffset + centralDirectorySize !== eocdOffset ||
    buffer.readUInt32LE(centralDirectoryOffset) !== CENTRAL_HEADER_SIGNATURE
  ) {
    throw new Error('ZIP の中央ディレクトリが壊れています');
  }
  return { entryCount, centralDirectoryOffset, centralDirectorySize };
};

/** 中央ディレクトリのレコード 1 件ぶん（APPNOTE 4.3.12）。ローカルヘッダを読む位置と圧縮方式を持つ */
export interface ZipEntryRecord {
  name: string;
  /** 0 = 無圧縮（stored）、8 = deflate */
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/** 中央ディレクトリを走査してエントリ一覧を返す（純関数） */
export const listZipEntries = (buffer: Buffer): ZipEntryRecord[] => {
  const { entryCount, centralDirectoryOffset } = readZipCentralDirectory(buffer);
  const entries: ZipEntryRecord[] = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index++) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_HEADER_SIGNATURE) {
      throw new Error('ZIP の中央ディレクトリが壊れています');
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    entries.push({
      name: buffer.toString('utf8', offset + 46, offset + 46 + nameLength),
      method: buffer.readUInt16LE(offset + 10),
      compressedSize: buffer.readUInt32LE(offset + 20),
      uncompressedSize: buffer.readUInt32LE(offset + 24),
      localHeaderOffset: buffer.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
};

/**
 * 名前で指定したエントリを展開して返す（無ければ null）。xlsx のメタ情報（xl/workbook.xml 等、
 * 数 KB）を読む用途で、無圧縮と deflate だけに対応する。サイズは中央ディレクトリの値を使う
 * （ローカルヘッダはデータ記述子方式だと 0 のことがある）。
 */
export const readZipEntry = (buffer: Buffer, name: string): Buffer | null => {
  const entry = listZipEntries(buffer).find((candidate) => candidate.name === name);
  if (!entry) return null;
  const local = entry.localHeaderOffset;
  if (buffer.readUInt32LE(local) !== LOCAL_HEADER_SIGNATURE) {
    throw new Error('ZIP のローカルヘッダが壊れています');
  }
  const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
  const data = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error(`対応していない ZIP の圧縮方式です（method=${entry.method}）`);
};

/** 詰め物の中身（ゼロ埋め）と CRC32。モジュール初期化時に 1 回だけ計算し、以後は共有する */
const PADDING_DATA = Buffer.alloc(ZIP_PADDING_BYTES);
const PADDING_CRC32 = crc32(PADDING_DATA);
const PADDING_NAME = Buffer.from(ZIP_PADDING_ENTRY_NAME, 'utf8');

/** 詰め物のローカルファイルヘッダ（APPNOTE 4.3.7。無圧縮・データ記述子なし） */
const buildPaddingLocalHeader = (): Buffer => {
  const header = Buffer.alloc(30 + PADDING_NAME.byteLength);
  header.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(20, 4); // version needed to extract (2.0)
  header.writeUInt16LE(0, 6); // general purpose flags
  header.writeUInt16LE(0, 8); // compression method: stored
  header.writeUInt16LE(0, 10); // last mod time
  header.writeUInt16LE(0x21, 12); // last mod date (1980-01-01)
  header.writeUInt32LE(PADDING_CRC32, 14);
  header.writeUInt32LE(ZIP_PADDING_BYTES, 18); // compressed size
  header.writeUInt32LE(ZIP_PADDING_BYTES, 22); // uncompressed size
  header.writeUInt16LE(PADDING_NAME.byteLength, 26);
  header.writeUInt16LE(0, 28); // extra field length
  PADDING_NAME.copy(header, 30);
  return header;
};

/** 詰め物の中央ディレクトリレコード（APPNOTE 4.3.12） */
const buildPaddingCentralHeader = (localHeaderOffset: number): Buffer => {
  const header = Buffer.alloc(46 + PADDING_NAME.byteLength);
  header.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(20, 4); // version made by
  header.writeUInt16LE(20, 6); // version needed to extract
  header.writeUInt16LE(0, 8); // flags
  header.writeUInt16LE(0, 10); // method: stored
  header.writeUInt16LE(0, 12); // time
  header.writeUInt16LE(0x21, 14); // date
  header.writeUInt32LE(PADDING_CRC32, 16);
  header.writeUInt32LE(ZIP_PADDING_BYTES, 20);
  header.writeUInt32LE(ZIP_PADDING_BYTES, 24);
  header.writeUInt16LE(PADDING_NAME.byteLength, 28);
  header.writeUInt16LE(0, 30); // extra length
  header.writeUInt16LE(0, 32); // comment length
  header.writeUInt16LE(0, 34); // disk number start
  header.writeUInt16LE(0, 36); // internal attributes
  header.writeUInt32LE(0, 38); // external attributes
  header.writeUInt32LE(localHeaderOffset, 42);
  PADDING_NAME.copy(header, 46);
  return header;
};

/** 終端レコード（APPNOTE 4.3.16。コメントなし） */
const buildEndOfCentralDirectory = (
  entryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number,
): Buffer => {
  const record = Buffer.alloc(EOCD_MIN_LENGTH);
  record.writeUInt32LE(EOCD_SIGNATURE, 0);
  record.writeUInt16LE(0, 4); // this disk
  record.writeUInt16LE(0, 6); // disk with central directory
  record.writeUInt16LE(entryCount, 8);
  record.writeUInt16LE(entryCount, 10);
  record.writeUInt32LE(centralDirectorySize, 12);
  record.writeUInt32LE(centralDirectoryOffset, 16);
  record.writeUInt16LE(0, 20); // comment length
  return record;
};

/** 大きなバイト列を STREAM_CHUNK_BYTES ごとの subarray に分ける（コピーしない） */
const splitIntoChunks = (buffer: Buffer): Buffer[] => {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < buffer.byteLength; offset += STREAM_CHUNK_BYTES) {
    chunks.push(buffer.subarray(offset, Math.min(offset + STREAM_CHUNK_BYTES, buffer.byteLength)));
  }
  return chunks;
};

/**
 * 元の ZIP の中央ディレクトリ直前に詰め物エントリを挿入したバイト列を、チャンクの配列で返す（純関数）。
 * 元のバイト列はコピーせず subarray で参照し、STREAM_CHUNK_BYTES 以下に切って返す
 * （数十 MB の xlsx を二重に持たない。unzipper 側のコピーもチャンク 1 個ぶんで済む）。
 * 元 ZIP の既存エントリはローカルヘッダのオフセットが変わらないため、中央ディレクトリの
 * レコードはそのまま流用できる。
 */
export const buildPaddedZipChunks = (buffer: Buffer): Buffer[] => {
  const { entryCount, centralDirectoryOffset, centralDirectorySize } =
    readZipCentralDirectory(buffer);
  if (entryCount + 1 > 0xfffe) {
    throw new Error('ZIP のエントリ数が多すぎます');
  }

  const paddingLocalHeader = buildPaddingLocalHeader();
  const paddingLocalOffset = centralDirectoryOffset;
  const newCentralDirectoryOffset =
    paddingLocalOffset + paddingLocalHeader.byteLength + ZIP_PADDING_BYTES;
  const paddingCentralHeader = buildPaddingCentralHeader(paddingLocalOffset);
  const newCentralDirectorySize = centralDirectorySize + paddingCentralHeader.byteLength;

  return [
    ...splitIntoChunks(buffer.subarray(0, centralDirectoryOffset)),
    paddingLocalHeader,
    ...splitIntoChunks(PADDING_DATA),
    ...splitIntoChunks(
      buffer.subarray(centralDirectoryOffset, centralDirectoryOffset + centralDirectorySize),
    ),
    paddingCentralHeader,
    buildEndOfCentralDirectory(entryCount + 1, newCentralDirectorySize, newCentralDirectoryOffset),
  ];
};

/**
 * exceljs の WorkbookReader に渡す入力ストリーム。ZIP として不正なバイト列は、詰め物を付けずに
 * そのまま流す（WorkbookReader 側が読み取りエラーにする。ここで例外にすると「壊れたファイル」の
 * 扱いが呼び出し側で二重になるため）。
 */
export const createXlsxStreamSource = (buffer: Buffer): Readable => {
  let chunks: Buffer[];
  try {
    chunks = buildPaddedZipChunks(buffer);
  } catch {
    chunks = splitIntoChunks(buffer);
  }
  return Readable.from(chunks);
};
