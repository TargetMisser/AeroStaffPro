import type { Preview } from '@storybook/react';

const preview: Preview = {
  parameters: {
    actions: { argTypesRegex: '^on[A-Z].*' },
    backgrounds: {
      default: 'AeroStaff dark',
      values: [
        { name: 'AeroStaff dark', value: '#05070A' },
        { name: 'Warm runway', value: '#140C07' },
        { name: 'Operations board', value: '#0B1114' },
      ],
    },
  },
};

export default preview;
