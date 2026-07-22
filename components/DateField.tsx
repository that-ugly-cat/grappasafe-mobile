import { useState } from "react";
import { Pressable, Text, StyleProp, ViewStyle } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";

interface Props {
  /** ISO date "YYYY-MM-DD" or "" when unset. */
  value: string;
  onChange: (iso: string) => void;
  placeholder: string;
  style?: StyleProp<ViewStyle>;
  color?: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function toISO(d: Date): string {
  // Local components, not toISOString(), to avoid a timezone day-shift.
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function parseISO(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

/** A tappable field that opens the native date picker. Stores an ISO string,
 * shows it in the device's locale format. */
export default function DateField({ value, onChange, placeholder, style, color = "#fff" }: Props) {
  const [show, setShow] = useState(false);
  const parsed = parseISO(value);
  const display = parsed ? parsed.toLocaleDateString() : "";

  return (
    <>
      <Pressable style={style} onPress={() => setShow(true)}>
        <Text style={{ color: display ? color : "#666", fontSize: 16 }}>
          {display || placeholder}
        </Text>
      </Pressable>
      {show && (
        <DateTimePicker
          value={parsed ?? new Date(1990, 0, 1)}
          mode="date"
          maximumDate={new Date()}
          onChange={(e, d) => {
            setShow(false);
            if (e.type !== "dismissed" && d) onChange(toISO(d));
          }}
        />
      )}
    </>
  );
}
