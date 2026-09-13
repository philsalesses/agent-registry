'use server';

import { updateTag } from 'next/cache';
import { receiptTag } from '@/lib/api';

/** Expire the cached receipt so the party who just acted sees the new state on refresh */
export async function refreshReceipt(id: string): Promise<void> {
  if (!/^rc_[A-Za-z0-9]{8,64}$/.test(id)) return;
  updateTag(receiptTag(id));
}
