import { NextResponse } from 'next/server'

/** Disabled routes cannot create or rotate credentials as a side effect. */
export function POST() {
  return NextResponse.json({ error: 'Remote companion disabled' }, { status: 403 })
}
