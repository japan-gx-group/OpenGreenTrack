'use client';

// 保存していない入力があるまま画面を離れる前に、止めて聞くためのフック（どの機能の画面でも使える）。
// - タブを閉じる・再読み込み・別のサイトへの移動は、ブラウザの確認（beforeunload）で止める。
// - アプリの中の移動（next/link のリンク・サイドバー・パンくず・「戻る」のリンク）は、document の click を capture 段階で拾い、
//   同じオリジンの別の画面へ移る a[href] の移動を止めて、画面の中の確認ダイアログを出せるようにする
//   （App Router には移動を止める API が無いため。リンクの React の onClick より先に動き、伝播を止める）。
// - 「破棄して移動」を選んだら、止めたリンクをもう一度押して、リンク本来の移動（next/link ならクライアントの移動）をさせる。
//   押し直しの click は 1 回だけ通す（同じ画面のまま残ったときに、以後の移動を止めなくならないように）。
// 止めないもの（使う画面の側で、未保存のままこれらで移らないようにする）:
// - ブラウザの「戻る」「進む」（popstate）。App Router が履歴の移動を自分で扱うため、横から止めると履歴と画面が食い違う。
// - ボタンなどからの router.push / router.replace（a[href] の click ではないため拾えない。使う画面で確認を通してから呼ぶ）。
// - サイドバーのログアウト（router.replace で移る。ログアウトは利用者が明示的に選ぶ操作として扱う）。
// - 同じオリジンでも /api/ へのリンク（ファイルの出力など。画面の移動ではない）。
// 確認ダイアログの見た目と文言は、使う画面の側で持つ（このフックは状態だけを持つ）。

import { useCallback, useEffect, useRef, useState } from 'react';

type LinkClick = Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'defaultPrevented'>;

/**
 * リンクの click が、いまの画面を離れるアプリの中の移動か。止めるのはこのときだけ。
 * 新しいタブ・ウィンドウで開く（修飾キー・中クリック・target）、ダウンロード、別のオリジン（beforeunload が扱う）、
 * 同じ画面の中の移動（# だけが違う・同じ URL）、/api/ へのリンク（ファイルの出力など。画面の移動ではない）は止めない。
 */
export const isLeavingLinkClick = (event: LinkClick, anchor: HTMLAnchorElement, current: URL): boolean => {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const target = anchor.getAttribute('target');
  if (target && target !== '_self') return false;
  if (anchor.hasAttribute('download')) return false;
  const href = anchor.getAttribute('href');
  if (href === null) return false;
  let url: URL;
  try {
    url = new URL(href, current);
  } catch {
    return false;
  }
  if (url.origin !== current.origin) return false;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return false;
  return url.pathname !== current.pathname || url.search !== current.search;
};

export interface UnsavedChangesGuard {
  /** アプリの中の移動を止めて、確認を待っているとき true。 */
  isConfirming: boolean;
  /** 入力を捨てて、止めた移動を続ける。 */
  confirmLeave: () => void;
  /** 移動をやめて、編集に戻る。 */
  cancelLeave: () => void;
}

/**
 * enabled（保存していない入力がある）の間だけ、画面を離れる操作を止める。
 * 止めるのは、タブを閉じる・再読み込み・別のサイトへの移動（beforeunload）と、同じオリジンの別の画面へ移る a[href] の click。
 * ブラウザの「戻る」、router.push / router.replace での移動（ログアウトを含む）、/api/ へのリンクは止めない（ファイル先頭の説明）。
 */
export function useUnsavedChangesGuard(enabled: boolean): UnsavedChangesGuard {
  const [pendingLink, setPendingLink] = useState<HTMLAnchorElement | null>(null);
  // 「破棄して移動」の押し直しの click を 1 回だけ通す印（次の click の判定で消費する）。
  const passNextClickRef = useRef(false);
  // 「破棄して移動」の後、ページ全体の移動で起きる beforeunload を止めない印。利用者が次に操作する（押す・キーを打つ）まで有効
  // （beforeunload はブラウザによって押し直しの後に遅れて届くため、決まった時間では戻さない）。
  const allowUnloadRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    passNextClickRef.current = false;
    allowUnloadRef.current = false;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowUnloadRef.current) return;
      event.preventDefault();
      // 古いブラウザは returnValue を設定しないと確認を出さない。
      event.returnValue = '';
    };
    const handleUserInput = () => { allowUnloadRef.current = false; };
    const handleClick = (event: MouseEvent) => {
      if (passNextClickRef.current) {
        passNextClickRef.current = false;
        return;
      }
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (!isLeavingLinkClick(event, anchor, new URL(window.location.href))) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingLink(anchor);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('pointerdown', handleUserInput, true);
    document.addEventListener('keydown', handleUserInput, true);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('pointerdown', handleUserInput, true);
      document.removeEventListener('keydown', handleUserInput, true);
      // 未保存が無くなったら、待っていた確認も取り消す（後で未保存になったときに、古い移動の確認を出さない）。
      setPendingLink(null);
    };
  }, [enabled]);

  const confirmLeave = useCallback(() => {
    const link = pendingLink;
    setPendingLink(null);
    if (!link) return;
    allowUnloadRef.current = true;
    if (link.isConnected) {
      passNextClickRef.current = true;
      link.click();
      // 押し直しの click が届かなかった（ほかで止められた）ときに、印を後の利用者の click まで残さない。
      passNextClickRef.current = false;
    } else {
      window.location.assign(link.href);
    }
  }, [pendingLink]);

  const cancelLeave = useCallback(() => setPendingLink(null), []);

  return {
    // 確認を待つ間に保存した（未保存が無くなった）ときは、確認を閉じる（移動はさせない。もう一度押せば移る）。
    isConfirming: enabled && pendingLink !== null,
    confirmLeave,
    cancelLeave,
  };
}
