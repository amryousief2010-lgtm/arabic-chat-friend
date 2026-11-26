/** نتيجة product_rename_factory_check: ارتباط المنتج بأصناف مصنع اللحوم التامة قبل الحفظ وبعده. */
export interface RenameFactoryCheck {
  is_processed: boolean;
  linked_by_id: string[];
  name_linked_kept: string[];
  name_linked_lost: string[];
  will_be_unlinked: boolean;
}

const norm = (s: string) =>
  (s || "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();

/** هل تغيّر الاسم فعلًا (بعد توحيد الهمزات والتاء المربوطة والمسافات)؟ */
export function isRealRename(oldName: string, newName: string): boolean {
  return norm(oldName) !== norm(newName);
}

/**
 * التحذير يظهر فقط لو إعادة التسمية هي اللي هتفصل المنتج المصنّع عن صنف المصنع:
 * كان فيه صنف مربوط بالاسم، وبعد الاسم الجديد مش هيفضل ولا صنف مربوط.
 */
export function shouldWarnRename(check: RenameFactoryCheck | null | undefined): boolean {
  if (!check || !check.is_processed) return false;
  return check.will_be_unlinked && (check.name_linked_lost?.length ?? 0) > 0;
}
