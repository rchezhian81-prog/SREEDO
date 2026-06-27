/** Message text for generated notifications (reused for in-app + email/SMS/push). */

export function feeReminderMessage(vars: {
  studentName: string;
  amount: number;
  institutionName: string;
}): { subject: string; body: string } {
  return {
    subject: `Fee reminder — ${vars.studentName}`,
    body:
      `This is a reminder that ${vars.studentName} has an outstanding fee ` +
      `balance of ${vars.amount.toFixed(2)}. Please clear it at your earliest ` +
      `convenience.\n\n— ${vars.institutionName}`,
  };
}

export function absenceAlertMessage(vars: {
  studentName: string;
  date: string;
  institutionName: string;
}): { subject: string; body: string } {
  return {
    subject: `Absence alert — ${vars.studentName}`,
    body:
      `${vars.studentName} was marked absent on ${vars.date}. Please contact ` +
      `the school if this is unexpected.\n\n— ${vars.institutionName}`,
  };
}
