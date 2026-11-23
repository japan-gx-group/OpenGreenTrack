import { describe, expect, it } from 'vitest';
import { SSBJ_REPORT_PAGE_TITLES } from '@/components/layout/navItems';
import { SSBJ_REPORT_CONTENTS } from '../reportContents';

describe('SSBJ_REPORT_CONTENTS', () => {
  it('レポートの内容の画面名と、パンくずの画面名が同じ', () => {
    expect(Object.fromEntries(SSBJ_REPORT_CONTENTS.map(content => [content.path, content.label]))).toEqual(SSBJ_REPORT_PAGE_TITLES);
  });
});
