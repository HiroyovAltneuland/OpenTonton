// CSV quoting does not stop spreadsheet formula execution. Preserve the value
// but force text when a formula prefix follows whitespace or control characters.
export function csvCell(value:string):string {
  const literal=/^[\s\uFEFF]*[=+@-]|^[\t\r\n]/u.test(value)?"'"+value:value;
  return '"'+literal.replaceAll('"','""')+'"';
}
