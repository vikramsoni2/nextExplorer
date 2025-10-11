/// <reference types="vite/client" />

declare module '@xterm/addon-fit' {
  import type { Terminal } from '@xterm/xterm';

  export class FitAddon {
    activate(terminal: Terminal): void;
    dispose(): void;
    fit(): void;
  }
}

declare module 'codemirror' {
  export interface Editor {
    getValue(): string;
    setValue(content: string): void;
    doc: {
      isClean(generation?: number): boolean;
      changeGeneration(closeEvent?: boolean): number;
      replaceRange(content: string, from: { line: number; ch?: number }): void;
    };
    markClean(): void;
    on(event: 'change', handler: (instance: Editor) => void): void;
    state: Record<string, any>;
  }

  export interface EditorFromTextArea extends Editor {
    getTextArea(): HTMLTextAreaElement;
  }

  export interface EditorConfiguration {
    mode?: string | Record<string, unknown>;
    theme?: string;
    lineNumbers?: boolean;
    lint?: boolean | Record<string, unknown>;
    [key: string]: unknown;
  }

  export interface CodeMirrorExports {
    fromTextArea(
      textarea: HTMLTextAreaElement,
      config?: EditorConfiguration,
    ): EditorFromTextArea;
  }

  const CodeMirror: CodeMirrorExports;
  export default CodeMirror;
}

declare module 'codemirror/addon/lint/lint';
declare module 'codemirror/mode/htmlmixed/htmlmixed';
declare module 'codemirror/lib/codemirror.css';
declare module 'codemirror/theme/monokai.css';
declare module 'codemirror/theme/dracula.css';
declare module 'codemirror/theme/ambiance.css';
declare module 'codemirror/theme/material.css';
declare module 'codemirror/addon/lint/lint.css';
