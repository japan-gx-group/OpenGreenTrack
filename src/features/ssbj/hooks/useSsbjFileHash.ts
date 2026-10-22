'use client';

import { useRef, useState } from 'react';
import { sha256HexOfFile } from '../utils/fileHash';

/** 選んだファイルの SHA-256 をブラウザの中で計算する。続けて選び直したときは、最後に選んだファイルの結果だけを返す。 */
export function useSsbjFileHash() {
  const [isHashing, setIsHashing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const latest = useRef(0);

  const hash = async (file: File): Promise<string | null> => {
    const request = ++latest.current;
    setIsHashing(true);
    setErrorMessage('');
    try {
      const sha256 = await sha256HexOfFile(file);
      return request === latest.current ? sha256 : null;
    } catch (error) {
      if (request === latest.current) {
        setErrorMessage(error instanceof Error ? error.message : 'ファイルの SHA-256 を計算できませんでした');
      }
      return null;
    } finally {
      if (request === latest.current) setIsHashing(false);
    }
  };

  // 計算中のものがあれば結果を捨てる（ダイアログを閉じて別の根拠を開いたときに、前の結果が入らないように）。
  const reset = () => {
    latest.current += 1;
    setIsHashing(false);
    setErrorMessage('');
  };

  return { isHashing, errorMessage, hash, reset };
}
