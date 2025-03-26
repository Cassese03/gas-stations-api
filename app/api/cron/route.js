import { NextResponse } from 'next/server';

export async function GET() {

    try {
        const { updateDataIfNeed } = await import('@/app/service/index.js');
        await updateDataIfNeed();
    } catch (error) {
        console.error('Error in cron job:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

  return NextResponse.json({ ok: true });
}