'use client';

// 「画像（PNG・JPEG）を WebP に変換して容量を減らす」のチェックボックス。帳票の欄（EvidenceField）と
// 請求書の読取りのカードで同じものを使う。選択の読み書きは呼び出し側（hooks/useConvertPreference.ts）。

import React, { useId } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

export interface ConvertToWebpCheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

export const ConvertToWebpCheckbox = ({ checked, onCheckedChange, disabled }: ConvertToWebpCheckboxProps) => {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        disabled={disabled}
      />
      <Label htmlFor={id} className="text-xs font-normal text-text-muted">
        画像（PNG・JPEG）を WebP に変換して容量を減らす
      </Label>
    </div>
  );
};
