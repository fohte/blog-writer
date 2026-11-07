import type { Meta, StoryObj } from '@storybook/react-vite'

import { PremisePanelView } from '#components/premise-panel-view'

const discussion = {
  messages: [],
  proposals: {},
  draft: '',
  generating: false,
  error: undefined,
  onDraftChange: () => {},
  onSubmit: () => {},
  onAccept: () => {},
  onReject: () => {},
}

const repliedMessages = [
  {
    role: 'user',
    content: '読者は週末に何か作っている人。手間を減らす話がしたい',
  },
  {
    role: 'assistant',
    content:
      '読者を「同期の方式をまだ決めていない人」まで絞ると、比べる章が生きます。主張を案にしました。',
  },
] as const

const meta = {
  title: 'Editor/PremisePanelView',
  component: PremisePanelView,
  args: {
    values: {
      audience: '週末にウェブアプリを作っている人',
      purpose: '小さな同期の仕組みを選んだ理由を伝える',
      claim: '',
    },
    onValueChange: () => {},
    discussion,
  },
} satisfies Meta<typeof PremisePanelView>

export default meta
type Story = StoryObj<typeof meta>

export const WaitingForFirstMessage: Story = {
  name: 'the premise fields wait for the first message to the LLM',
}

export const ProposalsForSomeFields: Story = {
  name: 'the LLM proposes a revised reader and a new claim while the purpose stays unchanged',
  args: {
    discussion: {
      ...discussion,
      messages: repliedMessages,
      proposals: {
        audience:
          '週末にウェブアプリを作っていて、同期の方式をまだ決めていない人',
        claim: '1 人で使う道具なら、競合を人に選ばせない同期で十分に回る',
      },
    },
  },
}

export const Generating: Story = {
  name: 'an earlier proposal stays visible while the LLM prepares the next reply',
  args: {
    discussion: {
      ...discussion,
      messages: [
        ...repliedMessages,
        { role: 'user', content: '比べる相手も入れたい' },
      ],
      proposals: {
        claim: '1 人で使う道具なら、競合を人に選ばせない同期で十分に回る',
      },
      generating: true,
    },
  },
}

export const RequestFailed: Story = {
  name: 'the discussion keeps the draft and shows that the request failed',
  args: {
    discussion: {
      ...discussion,
      messages: repliedMessages,
      draft: '比べる相手も入れたい',
      error: 'LLM に接続できませんでした。',
    },
  },
}
