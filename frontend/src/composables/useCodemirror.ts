import { markRaw, onMounted, reactive, toRefs, unref, type Ref } from 'vue';

import CodeMirror from 'codemirror';
import type { Editor, EditorFromTextArea, EditorConfiguration } from 'codemirror';
import 'codemirror/mode/htmlmixed/htmlmixed';
import 'codemirror/lib/codemirror.css';
import 'codemirror/theme/monokai.css';
import 'codemirror/theme/dracula.css';
import 'codemirror/theme/ambiance.css';
import 'codemirror/theme/material.css';
import 'codemirror/addon/lint/lint';
import 'codemirror/addon/lint/lint.css';

interface UseCodeMirrorOptions {
  emit: (event: 'change', payload: { value: string }) => void;
  initialValue?: string;
  options?: EditorConfiguration;
  textareaRef: Ref<HTMLTextAreaElement | null>;
}

interface CodeMirrorState {
  cm: EditorFromTextArea | null;
  dirty: boolean | null;
  generation: number | null;
}

export default function useCodeMirror({
  emit,
  initialValue = '',
  options = {},
  textareaRef,
}: UseCodeMirrorOptions) {
  const state = reactive<CodeMirrorState>({
    cm: null,
    dirty: null,
    generation: null,
  });

  const hasErrors = (): boolean => Boolean(state.cm?.state.lint?.marked.length);

  const setValue = (val: string): void => {
    if (!state.cm) return;
    state.cm.setValue(val);
    state.generation = state.cm.doc.changeGeneration(true);
    state.cm.markClean();
    state.dirty = false;
  };

  const append = (val: string): void => {
    if (!state.cm) return;
    state.cm.doc.replaceRange(val, { line: Infinity } as any);
  };

  const initialize = (): void => {

    // CodeMirror.registerHelper("lint", options.mode, function (text) {
    //   return options.lint.getAnnotations;
    // });

    // create code mirror instance
    if (!textareaRef.value) return;

    state.cm = markRaw(
      CodeMirror.fromTextArea(textareaRef.value, {
        ...(unref(options) as EditorConfiguration),
      }),
    );

    // initialize editor with initial value
    state.cm.setValue(initialValue);

    // mark clean and prep for change tracking
    state.generation = state.cm.doc.changeGeneration(true);
    state.dirty = !state.cm.doc.isClean(state.generation);

    // synchronize with state (if dirty)
    state.cm.on('change', (cm: Editor) => {
      state.dirty = !state.cm?.doc.isClean(state.generation ?? undefined);
      emit('change', { value: cm.getValue() });
    });
  };

  onMounted(() => initialize());

  const { cm: editor, ...rest } = toRefs(state);

  return {
    ...rest,
    append,
    editor,
    hasErrors,
    setValue,
  };
}
