import { z } from 'zod'

export const PersonalUiState = z.object({
  activeConversationId: z.string().nullable(),
  previewArtifactId: z.string().nullable(),
  fileExplorerOpen: z.boolean(),
  openFilesByConv: z.record(z.string(), z.array(z.string().max(2000)).max(50)),
  activeTabByConv: z.record(z.string(), z.string().max(2000)),
})
export type PersonalUiStateValue = z.infer<typeof PersonalUiState>
