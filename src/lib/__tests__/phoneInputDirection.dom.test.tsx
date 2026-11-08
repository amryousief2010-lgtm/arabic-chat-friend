import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "@/components/ui/input";
import {
  customerSearchInputProps,
  insertAtSelection,
  phoneInputProps,
} from "../phoneInputDirection";

function SearchBox() {
  const [value, setValue] = useState("");
  const props = customerSearchInputProps(value);
  return (
    <div dir="rtl">
      <Input
        aria-label="بحث عن عميل"
        placeholder="بحث عن عميل..."
        value={value}
        onChange={(event) => setValue(event.target.value)}
        {...props}
        className={`pr-10 ${props.className}`}
      />
    </div>
  );
}

function PhoneBox() {
  const [value, setValue] = useState("");
  const props = phoneInputProps();
  return (
    <div dir="rtl">
      <Input
        aria-label="رقم الهاتف"
        placeholder="01xxxxxxxxx"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        {...props}
      />
    </div>
  );
}

function typeAt(input: HTMLInputElement, text: string) {
  let value = input.value;
  let caret = input.selectionStart ?? value.length;
  for (const ch of text) {
    const start = input.selectionStart ?? caret;
    const end = input.selectionEnd ?? start;
    const next = insertAtSelection(value, start, end, ch);
    fireEvent.change(input, { target: { value: next.value } });
    value = next.value;
    caret = next.caret;
    input.setSelectionRange(caret, caret);
  }
}

describe("order phone inputs inside an RTL page", () => {
  it("types, moves the caret, and pastes +20 without reversing digits", () => {
    render(<PhoneBox />);
    const input = screen.getByLabelText("رقم الهاتف") as HTMLInputElement;
    expect(input).toHaveAttribute("dir", "ltr");
    expect(input).toHaveStyle({ unicodeBidi: "isolate" });

    input.focus();
    input.setSelectionRange(0, 0);
    typeAt(input, "010");
    expect(input).toHaveValue("010");
    expect(input.selectionStart).toBe(3);

    input.setSelectionRange(1, 1);
    typeAt(input, "9");
    expect(input).toHaveValue("0910");
    expect(input.selectionStart).toBe(2);

    input.setSelectionRange(0, 4);
    const pasted = insertAtSelection(input.value, 0, 4, "+20 10");
    fireEvent.change(input, { target: { value: pasted.value } });
    input.setSelectionRange(pasted.caret, pasted.caret);
    expect(input).toHaveValue("+20 10");
    expect(input.selectionStart).toBe(6);
    expect(input).toHaveAttribute("dir", "ltr");
  });

  it("keeps Arabic-Indic digits in the order they were typed", () => {
    render(<PhoneBox />);
    const input = screen.getByLabelText("رقم الهاتف") as HTMLInputElement;
    input.focus();
    input.setSelectionRange(0, 0);
    typeAt(input, "٠١٠");
    expect(input).toHaveValue("٠١٠");
    expect(input).toHaveAttribute("dir", "ltr");
  });

  it("uses RTL for an Arabic name search and LTR once the query is a phone", () => {
    render(<SearchBox />);
    const input = screen.getByLabelText("بحث عن عميل") as HTMLInputElement;
    expect(input).toHaveAttribute("dir", "rtl");

    input.focus();
    input.setSelectionRange(0, 0);
    typeAt(input, "أحمد");
    expect(input).toHaveValue("أحمد");
    expect(input).toHaveAttribute("dir", "rtl");

    fireEvent.change(input, { target: { value: "" } });
    input.setSelectionRange(0, 0);
    typeAt(input, "+2010");
    expect(input).toHaveValue("+2010");
    expect(input).toHaveAttribute("dir", "ltr");
  });
});
