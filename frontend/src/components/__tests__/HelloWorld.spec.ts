import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';

import HelloWorld from '../HelloWorld.vue';

describe('HelloWorld', () => {
  it('renders the provided message', () => {
    const wrapper = mount(HelloWorld, {
      props: {
        msg: 'Hello Vite',
      },
    });

    expect(wrapper.text()).toContain('Hello Vite');
  });
});
