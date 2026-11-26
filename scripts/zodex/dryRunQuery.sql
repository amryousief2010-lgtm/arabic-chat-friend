-- Read-only export for dryRunAutolink.ts. Phones are md5(last 9 digits); no raw PII leaves the DB.
with o as (select o.id,o.order_number,o.total,o.created_at,o.status,o.fulfillment_type,o.shipping_bill_no b,
  array_remove(array[case when length(regexp_replace(c.phone,'\D','','g'))>=9 then md5(right(regexp_replace(c.phone,'\D','','g'),9)) end,
                     case when length(regexp_replace(c.phone2,'\D','','g'))>=9 then md5(right(regexp_replace(c.phone2,'\D','','g'),9)) end],null) ph
  from orders o left join customers c on c.id=o.customer_id where o.created_at > now()-interval '75 days'),
a as (select order_id,bill_no,min(created_at) first_at,(array_agg(match_reason order by created_at desc))[1] reason from zodex_bill_link_audit group by 1,2),
bo as (select bill_no,count(distinct order_id) n from zodex_bill_link_audit where match_reason not ilike '%unlink%' group by 1),
ob as (select order_id,count(distinct bill_no) n from zodex_bill_link_audit where match_reason not ilike '%unlink%' group by 1)
select json_agg(json_build_object('id',o.id,'n',o.order_number,'t',o.total,'c',o.created_at,'s',o.status,'f',o.fulfillment_type,'b',o.b,'ph',o.ph,
  'sa',a.first_at,'r',a.reason,'bo',coalesce(bo.n,0),'ob',coalesce(ob.n,0))) j
from o left join a on a.order_id=o.id and a.bill_no=o.b left join bo on bo.bill_no=o.b left join ob on ob.order_id=o.id;
