'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { BackLink } from '@/components/back-link';
import { DocAction } from '@/components/doc';
import {
  DocHeader,
  DocLines,
  DocSummary,
  type DocLineView,
} from '@/components/doc-detail';
import {
  Alert,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  Loading,
} from '@/components/ui';
import { useCan } from '@/components/user-context';
import { dateTh, money } from '@/lib/format';

interface Invoice {
  id: string;
  docNo: string;
  status: string;
  docDate: string;
  dueDate: string;
  subtotal: string;
  vatAmount: string;
  totalAmount: string;
  amountPaid: string;
  amountDue: string;
  partnerId: string;
  partner: { code: string; name: string; creditTermDays: number };
  lines: DocLineView[];
  allocations: {
    id: string;
    amount: string;
    payment: { docNo: string; paymentDate: string; method: string };
  }[];
}

const METHODS = [
  { value: 'CASH', label: 'เงินสด' },
  { value: 'TRANSFER', label: 'โอนเงิน' },
  { value: 'CHEQUE', label: 'เช็ค' },
  { value: 'CREDIT_CARD', label: 'บัตรเครดิต' },
];

export default function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const canWork = useCan(['ADMIN', 'MANAGER', 'SALES']);

  const [inv, setInv] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [payError, setPayError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api<Invoice>(`invoices/${id}`)
      .then((data) => {
        setInv(data);
        setAmount(String(data.amountDue));
      })
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : 'โหลดเอกสารไม่สำเร็จ'),
      );
  }, [id]);

  useEffect(load, [load]);

  async function recordPayment() {
    if (!inv) return;
    setPaying(true);
    setPayError(null);
    try {
      await api('payments', {
        method: 'POST',
        body: {
          partnerId: inv.partnerId,
          amount: Number(amount),
          method,
          reference: reference.trim() || undefined,
          allocations: [{ invoiceId: inv.id, amount: Number(amount) }],
        },
      });
      setPayOpen(false);
      setReference('');
      load();
    } catch (e) {
      setPayError(e instanceof ApiError ? e.message : 'บันทึกรับชำระไม่สำเร็จ');
    } finally {
      setPaying(false);
    }
  }

  const overdue =
    inv && Number(inv.amountDue) > 0 && new Date(inv.dueDate) < new Date();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <BackLink href="/sales?tab=invoices" label="กลับไปใบแจ้งหนี้" />

      {error && <ErrorState message={error} onRetry={load} />}
      {!inv && !error && <Loading />}

      {inv && (
        <>
          <DocHeader
            docNo={inv.docNo}
            status={inv.status}
            partnerName={inv.partner.name}
            docDate={inv.docDate}
          />

          {overdue && (
            <Alert>
              เลยกำหนดชำระแล้ว (ครบกำหนด {dateTh(inv.dueDate)}) — ค้างอยู่ ฿
              {money(inv.amountDue)}
            </Alert>
          )}

          {canWork && (
            <div className="flex flex-wrap gap-2">
              {inv.status === 'DRAFT' && (
                <DocAction
                  label="ออกใบแจ้งหนี้ (ส่งให้ลูกค้า)"
                  onDone={load}
                  action={() =>
                    api(`invoices/${id}/issue`, { method: 'PATCH' })
                  }
                />
              )}

              {['ISSUED', 'PARTIALLY_PAID'].includes(inv.status) && (
                <Button className="flex-1" onClick={() => setPayOpen((v) => !v)}>
                  {payOpen ? 'ปิดฟอร์มรับเงิน' : '💵 รับชำระเงิน'}
                </Button>
              )}

              {Number(inv.amountPaid) === 0 && inv.status !== 'VOID' && (
                <DocAction
                  label="ยกเลิกใบแจ้งหนี้"
                  variant="danger"
                  confirm="ยกเลิกใบแจ้งหนี้นี้ใช่ไหม?"
                  onDone={load}
                  action={() => api(`invoices/${id}/void`, { method: 'PATCH' })}
                />
              )}
            </div>
          )}

          {payOpen && (
            <Card className="space-y-3">
              <h2 className="font-medium">รับชำระเงิน</h2>
              {payError && <Alert>{payError}</Alert>}

              <Field
                label="จำนวนเงินที่รับ"
                hint={`ค้างอยู่ ฿${money(inv.amountDue)} — รับน้อยกว่านี้ได้ (จ่ายบางส่วน)`}
              >
                <Input
                  type="number"
                  min={0.01}
                  step="0.01"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="text-lg font-bold"
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="ช่องทาง">
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                    className="tap-target w-full rounded-lg border border-slate-300 bg-white px-3"
                  >
                    {METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="อ้างอิง" hint="เลขที่เช็ค / อ้างอิงการโอน">
                  <Input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </Field>
              </div>

              <Button
                onClick={() => void recordPayment()}
                loading={paying}
                disabled={Number(amount) <= 0}
                className="w-full"
              >
                บันทึกรับชำระ ฿{money(amount || 0)}
              </Button>
            </Card>
          )}

          <DocLines lines={inv.lines} />
          <DocSummary
            subtotal={inv.subtotal}
            vatAmount={inv.vatAmount}
            totalAmount={inv.totalAmount}
            amountPaid={inv.amountPaid}
            dueDate={inv.dueDate}
          />

          {inv.allocations.length > 0 && (
            <Card>
              <h2 className="mb-2 font-medium">ประวัติการรับชำระ</h2>
              <ul className="divide-y divide-slate-100">
                {inv.allocations.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-2 py-2 text-sm"
                  >
                    <span>
                      {a.payment.docNo}
                      <span className="text-slate-500">
                        {' · '}
                        {dateTh(a.payment.paymentDate)}
                        {' · '}
                        {METHODS.find((m) => m.value === a.payment.method)
                          ?.label ?? a.payment.method}
                      </span>
                    </span>
                    <span className="font-medium text-emerald-700">
                      ฿{money(a.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
