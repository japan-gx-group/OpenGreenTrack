import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSetupState, setupOrganization } from '../setup';
import type { SignupInput } from '../../types';

// createAdminClient は環境変数が無いと throw するため、DB アクセスはモックへ差し替える。
// admin.from('organizations').select('id', { count: 'exact', head: true }) の形だけを再現する。
const { selectMock, fromMock, createAdminClientMock, errorLog } = vi.hoisted(() => {
  const selectMock = vi.fn();
  const fromMock = vi.fn(() => ({ select: selectMock }));
  // setupOrganization のテストでは insert / delete も持つ別形の admin を差し込むため、戻り値の型は固定しない。
  const createAdminClientMock = vi.fn((): unknown => ({ from: fromMock }));
  return { selectMock, fromMock, createAdminClientMock, errorLog: vi.fn() };
});
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: createAdminClientMock }));
vi.mock('@/lib/logging/logger', () => ({ logger: { error: errorLog } }));

// 組織件数の問い合わせ結果を仕込む。
const mockOrganizationCount = (count: number) => {
  selectMock.mockResolvedValue({ count, error: null });
};

describe('getSetupState', () => {
  beforeEach(() => {
    selectMock.mockReset();
    fromMock.mockClear();
    createAdminClientMock.mockClear();
    createAdminClientMock.mockReturnValue({ from: fromMock });
    errorLog.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('組織が1件でもあれば completed を返す', async () => {
    mockOrganizationCount(3);
    await expect(getSetupState()).resolves.toBe('completed');
  });

  it('組織が0件なら pending を返す', async () => {
    mockOrganizationCount(0);
    await expect(getSetupState()).resolves.toBe('pending');
  });

  // 判定不能を completed と混ぜると、新規環境の構築時に「設定ミスで DB に繋がっていないだけ」
  // なのに「セットアップ済みです」と案内され、原因に辿り着けなくなる。
  describe('判定できない場合は completed と区別して unknown を返す', () => {
    it('件数の問い合わせがエラーを返したとき', async () => {
      selectMock.mockResolvedValue({ count: null, error: { message: 'boom' } });

      await expect(getSetupState()).resolves.toBe('unknown');
      expect(errorLog).toHaveBeenCalledOnce();
    });

    it('件数の問い合わせが reject したとき', async () => {
      selectMock.mockRejectedValue(new Error('network down'));

      await expect(getSetupState()).resolves.toBe('unknown');
      expect(errorLog).toHaveBeenCalledOnce();
    });

    // createAdminClient() は env 未設定で throw する。ここを拾い損ねると /signup が 500 になる。
    it('管理クライアントの生成が throw したとき（env 未設定）', async () => {
      createAdminClientMock.mockImplementation(() => {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY が必要です');
      });

      await expect(getSetupState()).resolves.toBe('unknown');
      expect(errorLog).toHaveBeenCalledOnce();
    });
  });

  describe('開発用バイパス（ALLOW_SETUP_WHEN_COMPLETED）', () => {
    it('開発時に有効なら、組織があっても pending を返し DB も引かない', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('ALLOW_SETUP_WHEN_COMPLETED', 'true');
      mockOrganizationCount(3);

      await expect(getSetupState()).resolves.toBe('pending');
      expect(createAdminClientMock).not.toHaveBeenCalled();
    });

    it("'true' 以外の値ではバイパスされない", async () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('ALLOW_SETUP_WHEN_COMPLETED', '1');
      mockOrganizationCount(3);

      await expect(getSetupState()).resolves.toBe('completed');
    });

    // 本番でフラグが効いてしまうと「誰でも新組織を作れる公開サインアップ」になる。
    // env の設定ミスだけでそうならないことを固定するための回帰テスト。
    it('本番ビルドではフラグが true でも無効', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('ALLOW_SETUP_WHEN_COMPLETED', 'true');
      mockOrganizationCount(3);

      await expect(getSetupState()).resolves.toBe('completed');
      expect(fromMock).toHaveBeenCalledWith('organizations');
    });
  });
});

// setupOrganization は organizations / profiles / locations / fiscal_years へ順に insert する。
// テーブルごとに insert の結果を差し替えられる admin モックを組み立てる。
type InsertResult = { data?: unknown; error: { message: string } | null };

const buildAdmin = (insertResults: Partial<Record<string, InsertResult>> = {}) => {
  const inserts: Record<string, unknown[]> = {};
  const deleted: string[] = [];
  const admin = {
    auth: {
      admin: {
        createUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
        deleteUser: vi.fn().mockResolvedValue({ data: null, error: null }),
      },
    },
    from: vi.fn((table: string) => {
      const result = insertResults[table] ?? { data: { id: `${table}-1` }, error: null };
      const insert = vi.fn((payload: unknown) => {
        (inserts[table] ??= []).push(payload);
        // organizations は .select('id').single() で id を受け取る。他は await するだけ。
        const chain = {
          select: () => ({ single: () => Promise.resolve(result) }),
          then: (resolve: (value: InsertResult) => unknown) => Promise.resolve(result).then(resolve),
        };
        return chain;
      });
      return {
        select: selectMock,
        insert,
        delete: () => ({
          eq: (_column: string, id: string) => {
            deleted.push(`${table}:${id}`);
            return Promise.resolve({ error: null });
          },
        }),
      };
    }),
  };
  return { admin, inserts, deleted };
};

const validInput: SignupInput = {
  fullName: '山田 太郎',
  email: 'admin@example.com',
  password: 'password123',
  organizationName: 'テスト株式会社',
  locations: [{ name: '本社', region: 'Kanto', type: 'headquarters' }],
};

describe('setupOrganization', () => {
  beforeEach(() => {
    selectMock.mockReset();
    mockOrganizationCount(0);
    createAdminClientMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  // 画面側の検証は type="button" の「次へ」で迂回され得るため、サーバ側でも形式を弾く。
  it('メールアドレスの形式が不正なら、ユーザーを作らずに失敗を返す', async () => {
    const { admin } = buildAdmin();
    createAdminClientMock.mockReturnValue(admin);

    const result = await setupOrganization({ ...validInput, email: 'taigasss' });

    expect(result).toEqual({ ok: false, error: 'メールアドレスの形式が正しくありません' });
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  // 年度が1件も無いと年度セレクタが「年度なし」になり、データ入力・レポートのどれも使えない。
  it('今日が属する会計年度（4月始まり）を1件作成する', async () => {
    vi.setSystemTime(new Date('2026-09-07T03:00:00Z'));
    const { admin, inserts } = buildAdmin();
    createAdminClientMock.mockReturnValue(admin);

    const result = await setupOrganization(validInput);

    expect(result).toEqual({ ok: true, data: { email: 'admin@example.com' } });
    expect(inserts.fiscal_years).toEqual([
      {
        organizationId: 'organizations-1',
        label: '2026年度',
        startDate: '2026-04-01',
        endDate: '2027-03-31',
      },
    ]);
  });

  it('1〜3月は前年の年度として作成する', async () => {
    vi.setSystemTime(new Date('2027-02-15T03:00:00Z'));
    const { admin, inserts } = buildAdmin();
    createAdminClientMock.mockReturnValue(admin);

    await setupOrganization(validInput);

    expect(inserts.fiscal_years?.[0]).toMatchObject({
      label: '2026年度',
      startDate: '2026-04-01',
      endDate: '2027-03-31',
    });
  });

  it('年度の作成に失敗したら組織とユーザーを消して失敗を返す', async () => {
    vi.setSystemTime(new Date('2026-09-07T03:00:00Z'));
    const { admin, deleted } = buildAdmin({
      fiscal_years: { error: { message: 'boom' } },
    });
    createAdminClientMock.mockReturnValue(admin);

    const result = await setupOrganization(validInput);

    expect(result).toEqual({ ok: false, error: '算定年度の作成に失敗しました' });
    expect(deleted).toEqual(['organizations:organizations-1']);
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith('user-1');
  });
});
