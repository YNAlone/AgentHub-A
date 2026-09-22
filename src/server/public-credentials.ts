import type { AgentRow, AppSettingsRow } from '@/db/schema'

import { CONFIGURED_SECRET } from '@/shared/credential-edit'
export { CONFIGURED_SECRET } from '@/shared/credential-edit'

/** Explicit allowlists prevent future database columns from leaking into browser responses. */
export function publicAgent(row: AgentRow): AgentRow {
  return {
    id: row.id, name: row.name, avatar: row.avatar, description: row.description,
    capabilities: row.capabilities, systemPrompt: row.systemPrompt, adapterName: row.adapterName,
    modelProvider: row.modelProvider, modelId: row.modelId, apiBaseUrl: row.apiBaseUrl,
    toolNames: row.toolNames, isBuiltin: row.isBuiltin, isOrchestrator: row.isOrchestrator,
    supportsVision: row.supportsVision, createdAt: row.createdAt,
    apiKey: row.apiKey ? CONFIGURED_SECRET : null,
  }
}

export function publicSettings(row: AppSettingsRow): AppSettingsRow {
  return {
    id: row.id,
    anthropicBaseUrl: row.anthropicBaseUrl,
    deploymentPublishEnabled: row.deploymentPublishEnabled,
    deploymentPublishDir: row.deploymentPublishDir,
    deploymentPublicBaseUrl: row.deploymentPublicBaseUrl,
    updatedAt: row.updatedAt,
    anthropicApiKey: row.anthropicApiKey ? CONFIGURED_SECRET : null,
    openaiApiKey: row.openaiApiKey ? CONFIGURED_SECRET : null,
    deepseekApiKey: row.deepseekApiKey ? CONFIGURED_SECRET : null,
    arkApiKey: row.arkApiKey ? CONFIGURED_SECRET : null,
    mobileDeviceToken: null,
    companionMode: 'off',
  }
}
