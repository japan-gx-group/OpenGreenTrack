import type { ReactNode } from 'react';
import { Sparkles, LayoutGrid, FileText } from 'lucide-react';
import { GreenTrackMark } from '@/components/ui/GreenTrackMark';

// 認証画面（ログイン / 初回登録ウィザード / 招待受諾 / パスワード再設定）で共通の2カラムシェル。
// src/app/(auth)/layout.tsx が 1 回だけ描き、各フォームは AuthFormFrame で幅を決めた本体だけを返す。
// 左は濃緑のブランドパネル（販促面）、右はペーパー地のフォーム面。
// 狭幅（lg 未満）ではブランドパネルを畳み、上部に緑の帯（ロゴのみ）を出す。

// 濃緑ブランドパネル専用のサブパレット。ペーパー地トークンには対応する値がないため、
// globals.css の --auth-panel-* トークン（R5）を参照する。パネル地の緑自体は --primary トークン。
const PANEL = {
  text: 'var(--color-auth-panel-text)',
  textSoft: 'var(--color-auth-panel-text-soft)',
  textBody: 'var(--color-auth-panel-text-body)',
  textFaint: 'var(--color-auth-panel-text-faint)',
  textLabel: 'var(--color-auth-panel-text-label)',
  accent: 'var(--color-auth-panel-accent)',
  chip: 'var(--color-auth-panel-chip)',
  circle1: 'var(--color-auth-panel-circle-1)',
  circle2: 'var(--color-auth-panel-circle-2)',
  footer: 'var(--color-auth-panel-footer)',
} as const;

const FEATURES = [
  { icon: Sparkles, label: 'Scope 1・2・3 を1つのフォームで入力' },
  { icon: LayoutGrid, label: '拠点・カテゴリ別に排出量を可視化' },
  { icon: FileText, label: '制度報告レポートをワンクリック出力' },
] as const;

export const AuthLayout = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-screen flex-col bg-bg-main lg:flex-row">
    {/* 狭幅用の上部ブランド帯（lg 未満のみ） */}
    <div
      className="flex items-center gap-3 bg-primary px-6 py-5 lg:hidden"
      style={{ color: PANEL.text }}
    >
      <span
        className="flex h-9 w-9 items-center justify-center rounded-[10px]"
        style={{ background: PANEL.chip }}
      >
        <GreenTrackMark size={22} />
      </span>
      <span>
        <span className="block font-serif text-lg font-semibold leading-none tracking-[0.2px]">
          GreenTrack
        </span>
        <span
          className="mt-1 block text-[9.5px] uppercase tracking-[0.16em]"
          style={{ color: PANEL.textLabel }}
        >
          GHG Management
        </span>
      </span>
    </div>

    {/* 濃緑ブランドパネル（lg 以上） */}
    <aside
      className="relative hidden shrink-0 flex-col overflow-hidden bg-primary px-[60px] py-14 lg:flex lg:w-[46%]"
      style={{ color: PANEL.text }}
    >
      {/* 装飾円 */}
      <span
        aria-hidden
        className="pointer-events-none absolute rounded-full"
        style={{ top: -140, right: -120, width: 420, height: 420, background: PANEL.circle1 }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute rounded-full"
        style={{ bottom: -180, left: -100, width: 360, height: 360, background: PANEL.circle2 }}
      />

      {/* ロゴ + ワードマーク */}
      <div className="relative flex items-center gap-[13px]">
        <span
          className="flex h-11 w-11 items-center justify-center rounded-xl"
          style={{ background: PANEL.chip }}
        >
          <GreenTrackMark size={28} />
        </span>
        <span>
          <span className="block font-serif text-[22px] font-semibold leading-none tracking-[0.2px]">
            GreenTrack
          </span>
          <span
            className="mt-1 block text-[10.5px] uppercase tracking-[0.16em]"
            style={{ color: PANEL.textLabel }}
          >
            GHG Management
          </span>
        </span>
      </div>

      {/* キャッチコピー + 要点リスト */}
      <div className="relative my-auto">
        <div
          className="mb-4 text-xs uppercase tracking-[0.18em]"
          style={{ color: PANEL.textFaint }}
        >
          Scope 1 – 3 を、ひとつの視点で
        </div>
        {/* ページの h1 は各フォーム側に置くため、こちらは装飾見出し（p）とする */}
        <p className="m-0 font-serif text-[38px] font-semibold leading-[1.3] tracking-[0.3px]">
          温室効果ガスの算定・
          <br />
          管理を、もっと確かに。
        </p>
        <p
          className="mt-[22px] max-w-[420px] text-[14.5px] leading-[1.8]"
          style={{ color: PANEL.textSoft }}
        >
          活動量の入力から拠点別の可視化、制度報告まで。サステナビリティ業務を一気通貫で支えます。
        </p>

        <ul className="mt-[38px] flex flex-col gap-4">
          {FEATURES.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-[13px]">
              <span
                className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px]"
                style={{ background: PANEL.chip }}
              >
                <Icon size={17} strokeWidth={1.9} style={{ color: PANEL.accent }} />
              </span>
              <span className="text-[13.5px]" style={{ color: PANEL.textBody }}>
                {label}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="relative text-[11.5px]" style={{ color: PANEL.footer }}>
        © 2026 GreenTrack · 日本GXグループ株式会社
      </div>
    </aside>

    {/* ペーパー地フォーム面 */}
    <main className="flex flex-1 items-center justify-center px-6 py-12 sm:px-10">
      {children}
    </main>
  </div>
);
