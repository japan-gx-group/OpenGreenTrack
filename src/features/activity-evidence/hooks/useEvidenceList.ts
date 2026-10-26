'use client';

// 「帳票の一覧」の読み込みと削除。開いている間だけ読み、削除したら一覧から外す。

import { useCallback, useEffect, useState } from 'react';
import type { EvidenceFileListItem } from '../types';
import { deleteEvidenceFile, getUploaderNames, listEvidenceFiles } from '../services/evidenceClient';

interface EvidenceListState {
  files: EvidenceFileListItem[];
  uploaderNames: Map<string, string>;
  /** 一度でも読み終えたか（読み終えるまでは「読み込んでいます」を出す） */
  loaded: boolean;
  error: string | null;
}

const INITIAL_STATE: EvidenceListState = { files: [], uploaderNames: new Map(), loaded: false, error: null };

const load = async (): Promise<EvidenceListState> => {
  try {
    const files = await listEvidenceFiles();
    const uploaderNames = await getUploaderNames(files.flatMap((file) => (file.uploadedBy ? [file.uploadedBy] : [])));
    return { files, uploaderNames, loaded: true, error: null };
  } catch (error) {
    return { ...INITIAL_STATE, loaded: true, error: error instanceof Error ? error.message : '帳票の一覧を取得できませんでした' };
  }
};

export const useEvidenceList = (isOpen: boolean) => {
  const [state, setState] = useState<EvidenceListState>(INITIAL_STATE);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 取得と反映を分け、.then(apply) の形で呼ぶ（react-hooks/set-state-in-effect 対応。useAiStatus と同じ方針）。
  const apply = useCallback((next: EvidenceListState) => setState(next), []);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    load().then((next) => {
      if (!cancelled) apply(next);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, apply]);

  const remove = useCallback(async (id: string) => {
    setDeletingId(id);
    setDeleteError(null);
    try {
      await deleteEvidenceFile(id);
      setState((current) => ({ ...current, files: current.files.filter((file) => file.id !== id) }));
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : '帳票を削除できませんでした');
    } finally {
      setDeletingId(null);
    }
  }, []);

  // 開き直したときは前に読んだ一覧を出したまま読み直す。
  return { ...state, isLoading: isOpen && !state.loaded, deletingId, deleteError, remove };
};
