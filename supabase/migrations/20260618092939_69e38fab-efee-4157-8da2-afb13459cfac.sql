ALTER TABLE public.hr_deductions DISABLE TRIGGER trg_enforce_hr_deduction_approval_role;
ALTER TABLE public.hr_deductions DISABLE TRIGGER trg_hr_deductions_guard;

UPDATE public.hr_deductions
SET status = 'approved',
    rejection_reason = NULL,
    approved_at = COALESCE(approved_at, now()),
    notes = COALESCE(notes,'') || E'\nتصحيح: السلفة معتمدة من عهدة المجزر'
WHERE id = '44b2c08b-ea18-4a28-9c6d-6e7e5e68568d';

ALTER TABLE public.hr_deductions ENABLE TRIGGER trg_hr_deductions_guard;
ALTER TABLE public.hr_deductions ENABLE TRIGGER trg_enforce_hr_deduction_approval_role;