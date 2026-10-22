import { expect, it } from 'vitest'
import { getContextCalibration, recordContextSample } from './context-calibration'

it('keeps cold-start byte counting and only relaxes a sampled request class', () => {
  const model = 'calibration-test-unique'
  expect(getContextCalibration('deepseek', model, null)).toEqual({ plainFactor: 1, toolFactor: 1 })
  for (let i = 0; i < 30; i++) recordContextSample('deepseek', model, null, 5000, 1000, false)
  expect(getContextCalibration('deepseek', model, null)).toEqual({ plainFactor: 0.25, toolFactor: 1 })
  recordContextSample('deepseek', model, null, 5000, 3500, false)
  expect(getContextCalibration('deepseek', model, null).plainFactor).toBe(0.875)
  for (let i = 0; i < 30; i++) recordContextSample('deepseek', model, null, 5000, 3000, true)
  expect(getContextCalibration('deepseek', model, null).toolFactor).toBe(0.75)
})
