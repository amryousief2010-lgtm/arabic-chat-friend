import DashboardLayout from '@/components/layout/DashboardLayout';
import ProcessedKgBonusSettings from '@/components/sales/ProcessedKgBonusSettings';

/** عنوان مباشر لجدول منحنى البونص. الحارس على المسار، والمكوّن بيرجع فاضي لو الدور مش مسموح. */
const BonusSchedule = () => (
  <DashboardLayout>
    <ProcessedKgBonusSettings />
  </DashboardLayout>
);

export default BonusSchedule;
