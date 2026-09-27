-- RLS initplan rewrite. Same policy names, roles, and commands.
-- Helper functions has_role, has_any_role, is_*_reviewer, is_hagar_account,
-- is_social_media_manager, order_matches_moderator, order_is_hagar, and
-- order_is_nora_or_aya are already STABLE. Volatility, SECURITY mode, and ACLs
-- are unchanged. current_user_normalized_name() is new and is not granted to anon.
--
-- order_matches_moderator is inlined. The one-direction LIKE from the investigation
-- is not equivalent (it drops the reverse match and the length >= 3 checks), so the
-- full predicate is kept, with the profile name evaluated once via
-- (SELECT current_user_normalized_name()).
-- order_is_hagar and order_is_nora_or_aya stay per row: both arguments are row columns.
--
-- Policies changed (before -> after):
--
-- customers | DELETE | Managers can delete customers
--   USING before: has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'marketing_sales_manager'::app_role])
--   USING after:  (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'marketing_sales_manager'::app_role]))
--
-- customers | INSERT | Authenticated users can create customers
--   CHECK before: has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'sales_moderator'::app_role])
--   CHECK after:  (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'sales_moderator'::app_role]))
--
-- customers | SELECT | Business roles can view customers
--   USING before: has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role, 'marketing_sales_viewer'::app_role, 'sales_moderator'::app_role, 'accountant'::app_role, 'financial_manager'::app_role, 'warehouse_supervisor'::app_role, 'agouza_warehouse_keeper'::app_role])
--   USING after:  (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role, 'marketing_sales_viewer'::app_role, 'sales_moderator'::app_role, 'accountant'::app_role, 'financial_manager'::app_role, 'warehouse_supervisor'::app_role, 'agouza_warehouse_keeper'::app_role]))
--
-- customers | SELECT | Managers and authorized roles can view all customers
--   USING before: has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role, 'accountant'::app_role, 'warehouse_supervisor'::app_role])
--   USING after:  (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role, 'accountant'::app_role, 'warehouse_supervisor'::app_role]))
--
-- customers | SELECT | Shipping company can view own-carrier customers
--   USING before: (has_role(auth.uid(), 'shipping_company'::app_role) AND (EXISTS ( SELECT 1 FROM (orders o JOIN profiles p ON ((p.id = auth.uid()))) WHERE ((o.customer_id = customers.id) AND (p.shipping_company_name IS NOT NULL) AND (o.shipping_company = p.shipping_company_name)))))
--   USING after:  ((SELECT has_role((SELECT auth.uid()), 'shipping_company'::app_role)) AND (EXISTS ( SELECT 1 FROM (orders o JOIN profiles p ON ((p.id = (SELECT auth.uid())))) WHERE ((o.customer_id = customers.id) AND (p.shipping_company_name IS NOT NULL) AND (o.shipping_company = p.shipping_company_name)))))
--
-- customers | SELECT | marketing_sales_viewer read
--   USING before: has_role(auth.uid(), 'marketing_sales_viewer'::app_role)
--   USING after:  (SELECT has_role((SELECT auth.uid()), 'marketing_sales_viewer'::app_role))
--
-- customers | UPDATE | Managers can update customers
--   USING before: has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role])
--   USING after:  (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role]))
--
-- customers | UPDATE | Sales moderators can update customers
--   USING before: has_role(auth.uid(), 'sales_moderator'::app_role)
--   USING after:  (SELECT has_role((SELECT auth.uid()), 'sales_moderator'::app_role))
--   CHECK before: has_role(auth.uid(), 'sales_moderator'::app_role)
--   CHECK after:  (SELECT has_role((SELECT auth.uid()), 'sales_moderator'::app_role))
--
-- notifications | DELETE | Managers can delete notifications
--   USING before: has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role])
--   USING after:  (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role]))
--
-- notifications | INSERT | Authenticated managers can create notifications
--   CHECK before: has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role])
--   CHECK after:  (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role]))
--
-- notifications | INSERT | Managers can send targeted notifications
--   CHECK before: has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'accountant'::app_role, 'financial_manager'::app_role])
--   CHECK after:  (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'accountant'::app_role, 'financial_manager'::app_role]))
--
-- notifications | INSERT | Private rep can send edit-request notifications
--   CHECK before: (has_role(auth.uid(), 'private_delivery_rep'::app_role) AND (type = 'edit_request'::text) AND (target_user_id IS NOT NULL))
--   CHECK after:  ((SELECT has_role((SELECT auth.uid()), 'private_delivery_rep'::app_role)) AND (type = 'edit_request'::text) AND (target_user_id IS NOT NULL))
--
-- notifications | UPDATE | Managers can update notifications
--   USING before: has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role])
--   USING after:  (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role]))
--
-- notifications | UPDATE | Private rep can update notifications for own delivery orders
--   USING before: (has_role(auth.uid(), 'private_delivery_rep'::app_role) AND (order_id IS NOT NULL) AND (EXISTS ( SELECT 1 FROM orders o WHERE ((o.id = notifications.order_id) AND (o.shipping_company = 'مندوب خاص'::text)))))
--   USING after:  ((SELECT has_role((SELECT auth.uid()), 'private_delivery_rep'::app_role)) AND (order_id IS NOT NULL) AND (EXISTS ( SELECT 1 FROM orders o WHERE ((o.id = notifications.order_id) AND (o.shipping_company = 'مندوب خاص'::text)))))
--
-- notifications | UPDATE | Users update their targeted notifications
--   USING before: (target_user_id = auth.uid())
--   USING after:  (target_user_id = (SELECT auth.uid()))
--
-- order_items | DELETE | Authorized roles can delete order items
--   USING before: has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role, 'shipping_company'::app_role, 'sales_moderator'::app_role])
--   USING after:  (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role, 'shipping_company'::app_role, 'sales_moderator'::app_role]))
--
-- order_items | INSERT | Authorized roles can create order items
--   CHECK before: has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'sales_moderator'::app_role, 'shipping_company'::app_role])
--   CHECK after:  (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'sales_moderator'::app_role, 'shipping_company'::app_role]))
--
-- order_items | SELECT | Hagar can view legacy Manal order items
--   USING before: (is_hagar_account(auth.uid()) AND (EXISTS ( SELECT 1 FROM orders o WHERE ((o.id = order_items.order_id) AND (o.moderator IS NOT NULL) AND (normalize_ar(o.moderator) ~~ '%منال%'::text)))))
--   USING after:  ((SELECT is_hagar_account((SELECT auth.uid()))) AND (EXISTS ( SELECT 1 FROM orders o WHERE ((o.id = order_items.order_id) AND (o.moderator IS NOT NULL) AND (normalize_ar(o.moderator) ~~ '%منال%'::text)))))
--
-- order_items | SELECT | Managers and authorized roles can view all order items
--   USING before: has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role, 'accountant'::app_role, 'warehouse_supervisor'::app_role])
--   USING after:  (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role, 'accountant'::app_role, 'warehouse_supervisor'::app_role]))
--
-- order_items | SELECT | Manal can review Nora and Aya order items
--   USING before: (is_manal_reviewer(auth.uid()) AND (EXISTS ( SELECT 1 FROM orders o WHERE ((o.id = order_items.order_id) AND order_is_nora_or_aya(o.moderator, o.created_by)))))
--   USING after:  ((SELECT is_manal_reviewer((SELECT auth.uid()))) AND (EXISTS ( SELECT 1 FROM orders o WHERE ((o.id = order_items.order_id) AND order_is_nora_or_aya(o.moderator, o.created_by)))))
--
-- order_items | SELECT | Nora can review Hagar order items
--   USING before: (is_nora_reviewer(( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM orders o WHERE ((o.id = order_items.order_id) AND order_is_hagar(o.moderator, o.created_by)))))
--   USING after:  ((SELECT is_nora_reviewer(( SELECT auth.uid() AS uid))) AND (EXISTS ( SELECT 1 FROM orders o WHERE ((o.id = order_items.order_id) AND order_is_hagar(o.moderator, o.created_by)))))
--
-- order_items | SELECT | Sales moderators can view items of their assigned orders
--   USING before: (( SELECT has_role(( SELECT auth.uid() AS uid), 'sales_moderator'::app_role) AS has_role) AND (EXISTS ( SELECT 1 FROM orders o WHERE ((o.id = order_items.order_id) AND ((o.created_by = ( SELECT auth.uid() AS uid)) OR order_matches_moderator(( SELECT auth.uid() AS uid), o.moderator))))))
--   USING after:  (( SELECT has_role(( SELECT auth.uid() AS uid), 'sales_moderator'::app_role) AS has_role) AND (EXISTS ( SELECT 1 FROM orders o WHERE ((o.id = order_items.order_id) AND ((o.created_by = ( SELECT auth.uid() AS uid)) OR (o.moderator IS NOT NULL AND length(public.normalize_ar(o.moderator)) >= 3 AND length((SELECT public.current_user_normalized_name())) >= 3 AND (public.normalize_ar(o.moderator) LIKE '%' || replace(replace(replace(COALESCE((SELECT public.current_user_normalized_name()), ''), '\', '\\'), '%', '\%'), '_', '\_') || '%' OR COALESCE((SELECT public.current_user_normalized_name()), '') LIKE '%' || replace(replace(replace(public.normalize_ar(o.moderator), '\', '\\'), '%', '\%'), '_', '\_') || '%')))))))
--
-- order_items | SELECT | Social media manager can view order_items read-only
--   USING before: is_social_media_manager(auth.uid())
--   USING after:  (SELECT is_social_media_manager((SELECT auth.uid())))
--
-- order_items | SELECT | marketing_sales_viewer read
--   USING before: has_role(auth.uid(), 'marketing_sales_viewer'::app_role)
--   USING after:  (SELECT has_role((SELECT auth.uid()), 'marketing_sales_viewer'::app_role))
--
-- order_items | UPDATE | Authorized roles can update order items
--   USING before: has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'shipping_company'::app_role, 'sales_moderator'::app_role])
--   USING after:  (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'shipping_company'::app_role, 'sales_moderator'::app_role]))
--   CHECK before: has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'shipping_company'::app_role, 'sales_moderator'::app_role])
--   CHECK after:  (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'shipping_company'::app_role, 'sales_moderator'::app_role]))
--
-- order_offer_instances | DELETE | order_offer_instances_delete
--   USING before: has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role])
--   USING after:  (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role]))
--
-- order_offer_instances | INSERT | order_offer_instances_insert
--   CHECK before: ((auth.uid() IS NOT NULL) AND ((created_by = auth.uid()) OR has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role])) AND (EXISTS ( SELECT 1 FROM orders o WHERE ((o.id = order_offer_instances.order_id) AND ((o.created_by = auth.uid()) OR has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role]))))))
--   CHECK after:  (((SELECT auth.uid()) IS NOT NULL) AND ((created_by = (SELECT auth.uid())) OR (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role]))) AND (EXISTS ( SELECT 1 FROM orders o WHERE ((o.id = order_offer_instances.order_id) AND ((o.created_by = (SELECT auth.uid())) OR (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role])))))))
--
-- order_offer_instances | UPDATE | order_offer_instances_update
--   USING before: (EXISTS ( SELECT 1 FROM orders o WHERE ((o.id = order_offer_instances.order_id) AND ((o.created_by = auth.uid()) OR has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role])))))
--   USING after:  (EXISTS ( SELECT 1 FROM orders o WHERE ((o.id = order_offer_instances.order_id) AND ((o.created_by = (SELECT auth.uid())) OR (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role]))))))
--   CHECK before: (EXISTS ( SELECT 1 FROM orders o WHERE ((o.id = order_offer_instances.order_id) AND ((o.created_by = auth.uid()) OR has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role])))))
--   CHECK after:  (EXISTS ( SELECT 1 FROM orders o WHERE ((o.id = order_offer_instances.order_id) AND ((o.created_by = (SELECT auth.uid())) OR (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role]))))))
--
-- orders | DELETE | Authorized roles can delete orders
--   USING before: has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'marketing_sales_manager'::app_role])
--   USING after:  (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'marketing_sales_manager'::app_role]))
--
-- orders | DELETE | Managers can delete orders
--   USING before: has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role])
--   USING after:  (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role]))
--
-- orders | INSERT | Authorized roles can create orders
--   CHECK before: ((auth.uid() = created_by) AND has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'sales_moderator'::app_role, 'marketing_sales_manager'::app_role]))
--   CHECK after:  (((SELECT auth.uid()) = created_by) AND (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'sales_moderator'::app_role, 'marketing_sales_manager'::app_role])))
--
-- orders | SELECT | Agouza keeper can view main pickup orders
--   USING before: (has_role(auth.uid(), 'agouza_warehouse_keeper'::app_role) AND (fulfillment_type = 'pickup'::text) AND (source_warehouse_id IN ( SELECT warehouses.id FROM warehouses WHERE ((warehouses.name ~~ '%الرئيسي%'::text) OR (warehouses.name ~~ '%المقر%'::text)))))
--   USING after:  ((SELECT has_role((SELECT auth.uid()), 'agouza_warehouse_keeper'::app_role)) AND (fulfillment_type = 'pickup'::text) AND (source_warehouse_id IN ( SELECT warehouses.id FROM warehouses WHERE ((warehouses.name ~~ '%الرئيسي%'::text) OR (warehouses.name ~~ '%المقر%'::text)))))
--
-- orders | SELECT | Agouza keeper can view outlet orders
--   USING before: (has_role(auth.uid(), 'agouza_warehouse_keeper'::app_role) AND (source_warehouse_id IN ( SELECT warehouses.id FROM warehouses WHERE (warehouses.name ~~ '%العجوزة%'::text))))
--   USING after:  ((SELECT has_role((SELECT auth.uid()), 'agouza_warehouse_keeper'::app_role)) AND (source_warehouse_id IN ( SELECT warehouses.id FROM warehouses WHERE (warehouses.name ~~ '%العجوزة%'::text))))
--
-- orders | SELECT | Hagar can view legacy Manal orders
--   USING before: (is_hagar_account(auth.uid()) AND (moderator IS NOT NULL) AND (normalize_ar(moderator) ~~ '%منال%'::text))
--   USING after:  ((SELECT is_hagar_account((SELECT auth.uid()))) AND (moderator IS NOT NULL) AND (normalize_ar(moderator) ~~ '%منال%'::text))
--
-- orders | SELECT | Managers and authorized roles can view all orders
--   USING before: has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role, 'accountant'::app_role, 'warehouse_supervisor'::app_role])
--   USING after:  (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role, 'accountant'::app_role, 'warehouse_supervisor'::app_role]))
--
-- orders | SELECT | Manal can review Nora and Aya orders
--   USING before: (is_manal_reviewer(auth.uid()) AND order_is_nora_or_aya(moderator, created_by))
--   USING after:  ((SELECT is_manal_reviewer((SELECT auth.uid()))) AND order_is_nora_or_aya(moderator, created_by))
--
-- orders | SELECT | Nora can review Hagar orders
--   USING before: (is_nora_reviewer(auth.uid()) AND order_is_hagar(moderator, created_by))
--   USING after:  ((SELECT is_nora_reviewer((SELECT auth.uid()))) AND order_is_hagar(moderator, created_by))
--
-- orders | SELECT | Private rep can view own shipping orders
--   USING before: (has_role(auth.uid(), 'private_delivery_rep'::app_role) AND (shipping_company = 'مندوب خاص'::text))
--   USING after:  ((SELECT has_role((SELECT auth.uid()), 'private_delivery_rep'::app_role)) AND (shipping_company = 'مندوب خاص'::text))
--
-- orders | SELECT | Sales moderators can view their own orders
--   USING before: (has_role(auth.uid(), 'sales_moderator'::app_role) AND (auth.uid() = created_by))
--   USING after:  ((SELECT has_role((SELECT auth.uid()), 'sales_moderator'::app_role)) AND ((SELECT auth.uid()) = created_by))
--
-- orders | SELECT | Shipping company can view own-carrier orders
--   USING before: (has_role(auth.uid(), 'shipping_company'::app_role) AND (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.shipping_company_name IS NOT NULL) AND (orders.shipping_company = p.shipping_company_name)))))
--   USING after:  ((SELECT has_role((SELECT auth.uid()), 'shipping_company'::app_role)) AND (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = (SELECT auth.uid())) AND (p.shipping_company_name IS NOT NULL) AND (orders.shipping_company = p.shipping_company_name)))))
--
-- orders | SELECT | Social media manager can view orders read-only
--   USING before: is_social_media_manager(auth.uid())
--   USING after:  (SELECT is_social_media_manager((SELECT auth.uid())))
--
-- orders | SELECT | marketing_sales_viewer read
--   USING before: has_role(auth.uid(), 'marketing_sales_viewer'::app_role)
--   USING after:  (SELECT has_role((SELECT auth.uid()), 'marketing_sales_viewer'::app_role))
--
-- orders | UPDATE | Managers can update any order
--   USING before: has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'accountant'::app_role, 'warehouse_supervisor'::app_role])
--   USING after:  (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'accountant'::app_role, 'warehouse_supervisor'::app_role]))
--
-- orders | UPDATE | Private rep can update own shipping orders
--   USING before: (has_role(auth.uid(), 'private_delivery_rep'::app_role) AND (shipping_company = 'مندوب خاص'::text))
--   USING after:  ((SELECT has_role((SELECT auth.uid()), 'private_delivery_rep'::app_role)) AND (shipping_company = 'مندوب خاص'::text))
--   CHECK before: (has_role(auth.uid(), 'private_delivery_rep'::app_role) AND (shipping_company = 'مندوب خاص'::text))
--   CHECK after:  ((SELECT has_role((SELECT auth.uid()), 'private_delivery_rep'::app_role)) AND (shipping_company = 'مندوب خاص'::text))
--
-- orders | UPDATE | Sales moderators can update their own orders
--   USING before: (has_role(auth.uid(), 'sales_moderator'::app_role) AND (auth.uid() = created_by))
--   USING after:  ((SELECT has_role((SELECT auth.uid()), 'sales_moderator'::app_role)) AND ((SELECT auth.uid()) = created_by))
--   CHECK before: (has_role(auth.uid(), 'sales_moderator'::app_role) AND (auth.uid() = created_by))
--   CHECK after:  ((SELECT has_role((SELECT auth.uid()), 'sales_moderator'::app_role)) AND ((SELECT auth.uid()) = created_by))
--
-- orders | UPDATE | Shipping company can update own-carrier orders
--   USING before: (has_role(auth.uid(), 'shipping_company'::app_role) AND (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.shipping_company_name IS NOT NULL) AND (orders.shipping_company = p.shipping_company_name)))))
--   USING after:  ((SELECT has_role((SELECT auth.uid()), 'shipping_company'::app_role)) AND (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = (SELECT auth.uid())) AND (p.shipping_company_name IS NOT NULL) AND (orders.shipping_company = p.shipping_company_name)))))
--   CHECK before: (has_role(auth.uid(), 'shipping_company'::app_role) AND (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.shipping_company_name IS NOT NULL) AND (orders.shipping_company = p.shipping_company_name)))))
--   CHECK after:  ((SELECT has_role((SELECT auth.uid()), 'shipping_company'::app_role)) AND (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = (SELECT auth.uid())) AND (p.shipping_company_name IS NOT NULL) AND (orders.shipping_company = p.shipping_company_name)))))
--
-- Already initplan, left unchanged:
--   customers | SELECT | Agouza keeper can view outlet customers
--   customers | SELECT | Private rep can view own shipping customers
--   customers | SELECT | Sales moderators can view all customers
--   notifications | SELECT | Managers can view all notifications
--   notifications | SELECT | Moderators view notifications for their own orders
--   notifications | SELECT | Private rep can view notifications for own delivery orders
--   notifications | SELECT | Private rep can view own targeted notifications
--   notifications | SELECT | Shipping company can view notifications
--   notifications | SELECT | Users view their targeted notifications
--   order_items | SELECT | Agouza keeper can view outlet order items
--   order_items | SELECT | Private rep can view own shipping order items
--   order_items | SELECT | Shipping company can view all order items
--   order_offer_instances | SELECT | order_offer_instances_select

CREATE OR REPLACE FUNCTION public.current_user_normalized_name()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.normalize_ar(p.full_name)
    FROM public.profiles p
   WHERE p.id = (SELECT auth.uid());
$$;

REVOKE ALL ON FUNCTION public.current_user_normalized_name() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_normalized_name() TO authenticated;

ALTER POLICY "Managers can delete customers" ON public.customers
  USING (
(SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'marketing_sales_manager'::app_role]))
  );

ALTER POLICY "Authenticated users can create customers" ON public.customers
  WITH CHECK (
(SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'sales_moderator'::app_role]))
  );

ALTER POLICY "Business roles can view customers" ON public.customers
  USING (
(SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role, 'marketing_sales_viewer'::app_role, 'sales_moderator'::app_role, 'accountant'::app_role, 'financial_manager'::app_role, 'warehouse_supervisor'::app_role, 'agouza_warehouse_keeper'::app_role]))
  );

ALTER POLICY "Managers and authorized roles can view all customers" ON public.customers
  USING (
(SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role, 'accountant'::app_role, 'warehouse_supervisor'::app_role]))
  );

ALTER POLICY "Shipping company can view own-carrier customers" ON public.customers
  USING (
((SELECT has_role((SELECT auth.uid()), 'shipping_company'::app_role)) AND (EXISTS ( SELECT 1
   FROM (orders o
     JOIN profiles p ON ((p.id = (SELECT auth.uid()))))
  WHERE ((o.customer_id = customers.id) AND (p.shipping_company_name IS NOT NULL) AND (o.shipping_company = p.shipping_company_name)))))
  );

ALTER POLICY "marketing_sales_viewer read" ON public.customers
  USING (
(SELECT has_role((SELECT auth.uid()), 'marketing_sales_viewer'::app_role))
  );

ALTER POLICY "Managers can update customers" ON public.customers
  USING (
(SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role]))
  );

ALTER POLICY "Sales moderators can update customers" ON public.customers
  USING (
(SELECT has_role((SELECT auth.uid()), 'sales_moderator'::app_role))
  )
  WITH CHECK (
(SELECT has_role((SELECT auth.uid()), 'sales_moderator'::app_role))
  );

ALTER POLICY "Managers can delete notifications" ON public.notifications
  USING (
(SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role]))
  );

ALTER POLICY "Authenticated managers can create notifications" ON public.notifications
  WITH CHECK (
(SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role]))
  );

ALTER POLICY "Managers can send targeted notifications" ON public.notifications
  WITH CHECK (
(SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'accountant'::app_role, 'financial_manager'::app_role]))
  );

ALTER POLICY "Private rep can send edit-request notifications" ON public.notifications
  WITH CHECK (
((SELECT has_role((SELECT auth.uid()), 'private_delivery_rep'::app_role)) AND (type = 'edit_request'::text) AND (target_user_id IS NOT NULL))
  );

ALTER POLICY "Managers can update notifications" ON public.notifications
  USING (
(SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role]))
  );

ALTER POLICY "Private rep can update notifications for own delivery orders" ON public.notifications
  USING (
((SELECT has_role((SELECT auth.uid()), 'private_delivery_rep'::app_role)) AND (order_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = notifications.order_id) AND (o.shipping_company = 'مندوب خاص'::text)))))
  );

ALTER POLICY "Users update their targeted notifications" ON public.notifications
  USING (
(target_user_id = (SELECT auth.uid()))
  );

ALTER POLICY "Authorized roles can delete order items" ON public.order_items
  USING (
(SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role, 'shipping_company'::app_role, 'sales_moderator'::app_role]))
  );

ALTER POLICY "Authorized roles can create order items" ON public.order_items
  WITH CHECK (
(SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'sales_moderator'::app_role, 'shipping_company'::app_role]))
  );

ALTER POLICY "Hagar can view legacy Manal order items" ON public.order_items
  USING (
((SELECT is_hagar_account((SELECT auth.uid()))) AND (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND (o.moderator IS NOT NULL) AND (normalize_ar(o.moderator) ~~ '%منال%'::text)))))
  );

ALTER POLICY "Managers and authorized roles can view all order items" ON public.order_items
  USING (
(SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role, 'accountant'::app_role, 'warehouse_supervisor'::app_role]))
  );

ALTER POLICY "Manal can review Nora and Aya order items" ON public.order_items
  USING (
((SELECT is_manal_reviewer((SELECT auth.uid()))) AND (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND order_is_nora_or_aya(o.moderator, o.created_by)))))
  );

ALTER POLICY "Nora can review Hagar order items" ON public.order_items
  USING (
((SELECT is_nora_reviewer(( SELECT auth.uid() AS uid))) AND (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND order_is_hagar(o.moderator, o.created_by)))))
  );

ALTER POLICY "Sales moderators can view items of their assigned orders" ON public.order_items
  USING (
(( SELECT has_role(( SELECT auth.uid() AS uid), 'sales_moderator'::app_role) AS has_role) AND (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND ((o.created_by = ( SELECT auth.uid() AS uid)) OR (o.moderator IS NOT NULL AND length(public.normalize_ar(o.moderator)) >= 3 AND length((SELECT public.current_user_normalized_name())) >= 3 AND (public.normalize_ar(o.moderator) LIKE '%' || replace(replace(replace(COALESCE((SELECT public.current_user_normalized_name()), ''), '\', '\\'), '%', '\%'), '_', '\_') || '%' OR COALESCE((SELECT public.current_user_normalized_name()), '') LIKE '%' || replace(replace(replace(public.normalize_ar(o.moderator), '\', '\\'), '%', '\%'), '_', '\_') || '%')))))))
  );

ALTER POLICY "Social media manager can view order_items read-only" ON public.order_items
  USING (
(SELECT is_social_media_manager((SELECT auth.uid())))
  );

ALTER POLICY "marketing_sales_viewer read" ON public.order_items
  USING (
(SELECT has_role((SELECT auth.uid()), 'marketing_sales_viewer'::app_role))
  );

ALTER POLICY "Authorized roles can update order items" ON public.order_items
  USING (
(SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'shipping_company'::app_role, 'sales_moderator'::app_role]))
  )
  WITH CHECK (
(SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'shipping_company'::app_role, 'sales_moderator'::app_role]))
  );

ALTER POLICY "order_offer_instances_delete" ON public.order_offer_instances
  USING (
(SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role]))
  );

ALTER POLICY "order_offer_instances_insert" ON public.order_offer_instances
  WITH CHECK (
(((SELECT auth.uid()) IS NOT NULL) AND ((created_by = (SELECT auth.uid())) OR (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role]))) AND (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_offer_instances.order_id) AND ((o.created_by = (SELECT auth.uid())) OR (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role])))))))
  );

ALTER POLICY "order_offer_instances_update" ON public.order_offer_instances
  USING (
(EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_offer_instances.order_id) AND ((o.created_by = (SELECT auth.uid())) OR (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role]))))))
  )
  WITH CHECK (
(EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_offer_instances.order_id) AND ((o.created_by = (SELECT auth.uid())) OR (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role]))))))
  );

ALTER POLICY "Authorized roles can delete orders" ON public.orders
  USING (
(SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'marketing_sales_manager'::app_role]))
  );

ALTER POLICY "Managers can delete orders" ON public.orders
  USING (
(SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role]))
  );

ALTER POLICY "Authorized roles can create orders" ON public.orders
  WITH CHECK (
(((SELECT auth.uid()) = created_by) AND (SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'sales_moderator'::app_role, 'marketing_sales_manager'::app_role])))
  );

ALTER POLICY "Agouza keeper can view main pickup orders" ON public.orders
  USING (
((SELECT has_role((SELECT auth.uid()), 'agouza_warehouse_keeper'::app_role)) AND (fulfillment_type = 'pickup'::text) AND (source_warehouse_id IN ( SELECT warehouses.id
   FROM warehouses
  WHERE ((warehouses.name ~~ '%الرئيسي%'::text) OR (warehouses.name ~~ '%المقر%'::text)))))
  );

ALTER POLICY "Agouza keeper can view outlet orders" ON public.orders
  USING (
((SELECT has_role((SELECT auth.uid()), 'agouza_warehouse_keeper'::app_role)) AND (source_warehouse_id IN ( SELECT warehouses.id
   FROM warehouses
  WHERE (warehouses.name ~~ '%العجوزة%'::text))))
  );

ALTER POLICY "Hagar can view legacy Manal orders" ON public.orders
  USING (
((SELECT is_hagar_account((SELECT auth.uid()))) AND (moderator IS NOT NULL) AND (normalize_ar(moderator) ~~ '%منال%'::text))
  );

ALTER POLICY "Managers and authorized roles can view all orders" ON public.orders
  USING (
(SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role, 'accountant'::app_role, 'warehouse_supervisor'::app_role]))
  );

ALTER POLICY "Manal can review Nora and Aya orders" ON public.orders
  USING (
((SELECT is_manal_reviewer((SELECT auth.uid()))) AND order_is_nora_or_aya(moderator, created_by))
  );

ALTER POLICY "Nora can review Hagar orders" ON public.orders
  USING (
((SELECT is_nora_reviewer((SELECT auth.uid()))) AND order_is_hagar(moderator, created_by))
  );

ALTER POLICY "Private rep can view own shipping orders" ON public.orders
  USING (
((SELECT has_role((SELECT auth.uid()), 'private_delivery_rep'::app_role)) AND (shipping_company = 'مندوب خاص'::text))
  );

ALTER POLICY "Sales moderators can view their own orders" ON public.orders
  USING (
((SELECT has_role((SELECT auth.uid()), 'sales_moderator'::app_role)) AND ((SELECT auth.uid()) = created_by))
  );

ALTER POLICY "Shipping company can view own-carrier orders" ON public.orders
  USING (
((SELECT has_role((SELECT auth.uid()), 'shipping_company'::app_role)) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND (p.shipping_company_name IS NOT NULL) AND (orders.shipping_company = p.shipping_company_name)))))
  );

ALTER POLICY "Social media manager can view orders read-only" ON public.orders
  USING (
(SELECT is_social_media_manager((SELECT auth.uid())))
  );

ALTER POLICY "marketing_sales_viewer read" ON public.orders
  USING (
(SELECT has_role((SELECT auth.uid()), 'marketing_sales_viewer'::app_role))
  );

ALTER POLICY "Managers can update any order" ON public.orders
  USING (
(SELECT has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'accountant'::app_role, 'warehouse_supervisor'::app_role]))
  );

ALTER POLICY "Private rep can update own shipping orders" ON public.orders
  USING (
((SELECT has_role((SELECT auth.uid()), 'private_delivery_rep'::app_role)) AND (shipping_company = 'مندوب خاص'::text))
  )
  WITH CHECK (
((SELECT has_role((SELECT auth.uid()), 'private_delivery_rep'::app_role)) AND (shipping_company = 'مندوب خاص'::text))
  );

ALTER POLICY "Sales moderators can update their own orders" ON public.orders
  USING (
((SELECT has_role((SELECT auth.uid()), 'sales_moderator'::app_role)) AND ((SELECT auth.uid()) = created_by))
  )
  WITH CHECK (
((SELECT has_role((SELECT auth.uid()), 'sales_moderator'::app_role)) AND ((SELECT auth.uid()) = created_by))
  );

ALTER POLICY "Shipping company can update own-carrier orders" ON public.orders
  USING (
((SELECT has_role((SELECT auth.uid()), 'shipping_company'::app_role)) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND (p.shipping_company_name IS NOT NULL) AND (orders.shipping_company = p.shipping_company_name)))))
  )
  WITH CHECK (
((SELECT has_role((SELECT auth.uid()), 'shipping_company'::app_role)) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND (p.shipping_company_name IS NOT NULL) AND (orders.shipping_company = p.shipping_company_name)))))
  );
