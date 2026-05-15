UPDATE order_items SET product_name = 'استيك' WHERE TRIM(product_name) = 'ستيك';
UPDATE order_items SET product_name = REGEXP_REPLACE(product_name, '(^|[^ا])ستيك', '\1استيك', 'g') WHERE product_name ~ '(^|[^ا])ستيك';
UPDATE products SET name = REGEXP_REPLACE(name, '(^|[^ا])ستيك', '\1استيك', 'g') WHERE name ~ '(^|[^ا])ستيك';