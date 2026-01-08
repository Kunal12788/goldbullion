
import { createClient } from '@supabase/supabase-js';
import { Invoice } from '../types';

// Supabase Credentials (from user prompt)
const SUPABASE_URL = 'https://frwfhwwclbutljjltjkt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_GFjJT0VabZ-DFCmPUurA9A_np_ijLwh';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Saves a single order (invoice) to the 'orders' table in Supabase.
 */
export const saveOrderToSupabase = async (invoice: Invoice) => {
  const orderPayload = {
    id: invoice.id,
    date: invoice.date,
    type: invoice.type,
    party_name: invoice.partyName,
    quantity_grams: invoice.quantityGrams,
    rate_per_gram: invoice.ratePerGram,
    gst_rate: invoice.gstRate,
    gst_amount: invoice.gstAmount,
    taxable_amount: invoice.taxableAmount,
    total_amount: invoice.totalAmount,
    cogs: invoice.cogs || 0,
    profit: invoice.profit || 0,
    created_at: new Date().toISOString()
  };

  try {
    const { data, error } = await supabase
      .from('orders')
      .insert([orderPayload]);

    if (error) {
      console.error('Supabase Insert Error:', error.message, error.details);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Supabase Connection Error:', err);
    return false;
  }
};
