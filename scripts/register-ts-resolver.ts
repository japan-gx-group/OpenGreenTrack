// scripts/ts-resolve-hooks.ts を Node のモジュールローダーに登録する（--import で読み込む）。
import { register } from 'node:module';

register('./ts-resolve-hooks.ts', import.meta.url);
