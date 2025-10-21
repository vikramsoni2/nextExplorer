import { markRaw, onMounted, reactive, toRefs, unref } from "vue";

import CodeMirror from "codemirror";
import "codemirror/mode/htmlmixed/htmlmixed";
import "codemirror/lib/codemirror.css";
import "codemirror/theme/monokai.css";
import "codemirror/theme/dracula.css";
import "codemirror/theme/ambiance.css";
import "codemirror/theme/material.css";
import "codemirror/addon/lint/lint";
import "codemirror/addon/lint/lint.css";

/**
 * @typedef {import('vue').Ref<HTMLTextAreaElement | null>} TextareaRef
 * @typedef {import('codemirror').EditorFromTextArea} CodeMirrorEditor
 * @typedef {import('codemirror').EditorConfiguration} EditorConfiguration
 */

/**
 * Lightweight wrapper around CodeMirror that keeps Vue reactivity in sync.
 * @param {{
 *  emit: (event: 'change', payload: { value: string }) => void,
 *  initialValue?: string,
 *  options?: EditorConfiguration | import('vue').Ref<EditorConfiguration>,
 *  textareaRef: TextareaRef
 * }} params
 * @returns {{
 *  dirty: import('vue').Ref<boolean>,
 *  generation: import('vue').Ref<number | null>,
 *  editor: import('vue').Ref<CodeMirrorEditor | null>,
 *  setValue: (value: string) => void,
 *  append: (value: string) => void,
 *  hasErrors: () => boolean
 * }}
 */
export default function useCodeMirror({
  emit,
  initialValue = "",
  options = {},
  textareaRef
}) {
  const state = reactive({
    /** @type {CodeMirrorEditor | null} */
    cm: null,
    dirty: false,
    /** @type {number | null} */
    generation: null
  });

  const hasErrors = () => Boolean(state.cm?.state?.lint?.marked?.length);

  const setValue = (val) => {
    if (!state.cm) {
      return;
    }
    state.cm.setValue(val);
    state.generation = state.cm.doc.changeGeneration(true);
    state.cm.markClean();
    state.dirty = false;
  };

  const append = (val) => {
    if (!state.cm) {
      return;
    }
    state.cm.doc.replaceRange(val, { line: Infinity });
  };

  const initialize = () => {
    const element = textareaRef?.value;
    if (!element) {
      return;
    }

    const resolvedOptions = unref(options);

    state.cm = markRaw(
      CodeMirror.fromTextArea(element, {
        ...resolvedOptions
      })
    );

    state.cm.setValue(initialValue);
    state.generation = state.cm.doc.changeGeneration(true);
    state.cm.markClean();
    state.dirty = false;

    state.cm.on("change", (cmInstance) => {
      if (!state.cm) {
        return;
      }
      state.dirty = !state.cm.doc.isClean(state.generation ?? undefined);
      emit("change", { value: cmInstance.getValue() });
    });
  };

  onMounted(() => initialize());

  const { cm: editor, ...rest } = toRefs(state);

  return {
    ...rest,
    append,
    editor,
    hasErrors,
    setValue
  };
}
