import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OTHER_JOB, isCatalogueJob, jobsForDepartment } from "@/lib/hr/jobCatalogue";

const NONE = "__none__";

interface Props {
  value: string | null | undefined;
  department?: string | null;
  onChange: (v: string) => void;
}

/** خانة الوظيفة: اختيار من الكتالوج (اختياري) أو «أخرى» بنص حر — القيم القديمة تظل كما هي */
const JobTitleField = ({ value, department, onChange }: Props) => {
  const v = (value || "").trim();
  const [other, setOther] = useState(!!v && !isCatalogueJob(v));
  const selectValue = other ? OTHER_JOB : v ? v : NONE;

  return (
    <div className="space-y-2">
      <Select
        value={selectValue}
        onValueChange={(s) => {
          if (s === OTHER_JOB) { setOther(true); return; }
          setOther(false);
          onChange(s === NONE ? "" : s);
        }}
      >
        <SelectTrigger data-testid="job-title-select"><SelectValue placeholder="اختر الوظيفة (اختياري)" /></SelectTrigger>
        <SelectContent className="max-h-80">
          <SelectItem value={NONE}>بدون وظيفة</SelectItem>
          {jobsForDepartment(department).filter((d) => d.jobs.length).map((d) => (
            <SelectGroup key={d.code}>
              <SelectLabel>{d.name}</SelectLabel>
              {d.jobs.map((j) => <SelectItem key={d.code + j.title} value={j.title}>{j.title}</SelectItem>)}
            </SelectGroup>
          ))}
          <SelectItem value={OTHER_JOB}>أخرى (اكتب المسمى)</SelectItem>
        </SelectContent>
      </Select>
      {other && (
        <Input data-testid="job-title-other" placeholder="اكتب المسمى الوظيفي" value={v} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
};

export default JobTitleField;
