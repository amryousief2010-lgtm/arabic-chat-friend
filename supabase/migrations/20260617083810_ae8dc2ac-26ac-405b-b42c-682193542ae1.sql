ALTER TABLE public.feed_factory_treasury_txns DROP CONSTRAINT feed_factory_treasury_txns_kind_check;
ALTER TABLE public.feed_factory_treasury_txns ADD CONSTRAINT feed_factory_treasury_txns_kind_check
CHECK (kind = ANY (ARRAY[
  'sale','purchase','loan_from_naam','loan_to_naam','manual_in','manual_out','opening_balance','other',
  'custody_shoala','custody_gamal','general_expense','tobacco_expense','transport_expense',
  'feed_sales_return_refund','feed_sales_return_cancel',
  'internal_collection','internal_collection_reversal','internal_feed_payment','internal_feed_payment_reversal'
]));