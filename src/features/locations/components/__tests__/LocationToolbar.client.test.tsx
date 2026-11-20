// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render } from '@/lib/testing/render';
import { LocationToolbar } from '../LocationToolbar.client';

describe('LocationToolbar', () => {
  it('shows the CSV row limit before selecting a file', () => {
    const rendered = render(
      <LocationToolbar
        onDownloadTemplate={vi.fn()}
        onExportCsv={vi.fn()}
        onSelectImportFile={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    try {
      const button = Array.from(rendered.container.querySelectorAll('button'))
        .find(element => element.textContent?.includes('CSVインポート'));
      expect(button?.title).toContain('最大 1,000 行');
      expect(button?.title).toContain('取り込む前に内容を確認できます');
    } finally {
      rendered.unmount();
    }
  });
});
