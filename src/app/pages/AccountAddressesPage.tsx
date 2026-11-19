import { useEffect, useState, type FormEvent } from "react";
import type { CountryCode } from "libphonenumber-js/min";
import AccountLayout from "./AccountLayout";
import { authInputCls, authLabelCls } from "./auth-shared";
import {
  buildPhonePayload,
  DEFAULT_PHONE_COUNTRY,
  isValidPhoneValue,
  PhoneField,
  splitStoredPhone,
} from "../components/PhoneField";
import {
  createAddress,
  deleteAddress,
  listAddresses,
  updateAddress,
  type CustomerAddress,
  type AddressInput,
} from "../lib/shop";
import { apiErrorText } from "./auth-shared";

const EMPTY: AddressInput = {
  label: "",
  recipientName: "",
  phone: "",
  addressLine: "",
  city: "",
  district: "",
  postalCode: "",
  deliveryNotes: "",
  isDefault: false,
};

function toInput(a: CustomerAddress): AddressInput {
  return {
    label: a.label ?? "",
    recipientName: a.recipientName,
    phone: a.phone,
    addressLine: a.addressLine,
    city: a.city,
    district: a.district ?? "",
    postalCode: a.postalCode ?? "",
    deliveryNotes: a.deliveryNotes ?? "",
    isDefault: a.isDefault,
  };
}

/**
 * Saved delivery addresses — full CRUD against /api/addresses. The form
 * is shared between create and edit; the first address a customer saves
 * becomes the default automatically (server behaviour).
 */
export default function AccountAddressesPage() {
  const [addresses, setAddresses] = useState<CustomerAddress[] | null>(null);
  const [editing, setEditing] = useState<CustomerAddress | "new" | null>(null);
  const [form, setForm] = useState<AddressInput>(EMPTY);
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(DEFAULT_PHONE_COUNTRY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const reload = () =>
    listAddresses()
      .then(setAddresses)
      .catch(() => setError("Your addresses could not be loaded. Please try again shortly."));

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openNew = () => {
    setForm(EMPTY);
    setPhoneCountry(DEFAULT_PHONE_COUNTRY);
    setEditing("new");
    setError(null);
  };

  const openEdit = (a: CustomerAddress) => {
    // Stored phones are E.164: split into selector country + national
    // part so the pair round-trips through the same validation.
    const split = splitStoredPhone(a.phone);
    setForm({ ...toInput(a), phone: split.national });
    setPhoneCountry(split.country);
    setEditing(a);
    setError(null);
  };

  const set = (key: keyof AddressInput) => (e: { target: { value: string; checked?: boolean; type: string } }) =>
    setForm((prev) => ({ ...prev, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isValidPhoneValue(form.phone, phoneCountry)) {
      setError("Enter a valid phone number, including the country code.");
      return;
    }
    setBusy(true);
    setError(null);
    const payload: AddressInput = {
      ...form,
      ...buildPhonePayload(form.phone, phoneCountry),
      label: form.label?.trim() ? form.label : null,
      district: form.district?.trim() ? form.district : null,
      postalCode: form.postalCode?.trim() ? form.postalCode : null,
      deliveryNotes: form.deliveryNotes?.trim() ? form.deliveryNotes : null,
    };
    try {
      if (editing === "new") await createAddress(payload);
      else if (editing) await updateAddress(editing.id, payload);
      setEditing(null);
      await reload();
    } catch (err) {
      setError(apiErrorText(err, "The address could not be saved."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    setError(null);
    try {
      await deleteAddress(id);
      setConfirmDelete(null);
      await reload();
    } catch (err) {
      setError(apiErrorText(err, "The address could not be deleted."));
    }
  };

  const makeDefault = async (a: CustomerAddress) => {
    setError(null);
    try {
      await updateAddress(a.id, { isDefault: true });
      await reload();
    } catch (err) {
      setError(apiErrorText(err, "The default address could not be changed."));
    }
  };

  return (
    <AccountLayout title="Delivery Addresses">
      {error && (
        <p className="mb-6 border border-destructive/40 bg-destructive/5 px-4 py-3 font-sans text-sm text-destructive">
          {error}
        </p>
      )}

      {addresses === null ? (
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Loading addresses…</p>
      ) : (
        <>
          <div className="grid gap-6 md:grid-cols-2">
            {addresses.map((a) => (
              <div key={a.id} className="border border-border bg-background p-6">
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-mono text-[0.63rem] uppercase tracking-[0.2em] text-muted-foreground">
                    {a.label || "Address"}
                  </span>
                  {a.isDefault && (
                    <span className="border border-accent/50 px-2 py-0.5 font-mono text-[0.58rem] uppercase tracking-widest text-accent">
                      Default
                    </span>
                  )}
                </div>
                <p className="font-sans text-sm leading-relaxed">
                  <span className="font-display text-base font-medium">{a.recipientName}</span>
                  <br />
                  {a.phone}
                  <br />
                  {a.addressLine}
                  <br />
                  {a.city}
                  {a.district ? `, ${a.district}` : ""}
                  {a.postalCode ? ` ${a.postalCode}` : ""}
                </p>
                {a.deliveryNotes && (
                  <p className="mt-2 font-sans text-sm font-light italic text-muted-foreground">
                    “{a.deliveryNotes}”
                  </p>
                )}
                <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
                  <button
                    onClick={() => openEdit(a)}
                    className="font-mono text-[0.63rem] uppercase tracking-widest text-accent transition-colors hover:text-foreground"
                  >
                    Edit
                  </button>
                  {!a.isDefault && (
                    <button
                      onClick={() => void makeDefault(a)}
                      className="font-mono text-[0.63rem] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Make default
                    </button>
                  )}
                  {confirmDelete === a.id ? (
                    <>
                      <span className="font-sans text-xs text-destructive">Delete this address?</span>
                      <button
                        onClick={() => void remove(a.id)}
                        className="font-mono text-[0.63rem] uppercase tracking-widest text-destructive"
                      >
                        Yes, delete
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="font-mono text-[0.63rem] uppercase tracking-widest text-muted-foreground"
                      >
                        Keep
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(a.id)}
                      className="font-mono text-[0.63rem] uppercase tracking-widest text-muted-foreground transition-colors hover:text-destructive"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
            {editing === null && (
              <button
                onClick={openNew}
                className="flex min-h-40 items-center justify-center border border-dashed border-border p-6 font-mono text-[0.66rem] uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:border-accent hover:text-accent"
              >
                + Add a new address
              </button>
            )}
          </div>

          {editing !== null && (
            <form onSubmit={submit} className="mt-10 border border-border bg-background p-7">
              <h2 className="mb-6 font-display text-xl font-medium">
                {editing === "new" ? "New address" : "Edit address"}
              </h2>
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label className={authLabelCls} htmlFor="addr-label">Label (optional)</label>
                  <input id="addr-label" className={authInputCls} value={form.label ?? ""} onChange={set("label")} placeholder="Home, Office…" />
                </div>
                <div>
                  <label className={authLabelCls} htmlFor="addr-name">Recipient name</label>
                  <input id="addr-name" required className={authInputCls} value={form.recipientName} onChange={set("recipientName")} placeholder="Who receives the parcel" />
                </div>
                <PhoneField
                  id="addr-phone"
                  label="Phone"
                  required
                  country={phoneCountry}
                  onCountryChange={setPhoneCountry}
                  value={form.phone}
                  onChange={(value) => setForm((prev) => ({ ...prev, phone: value }))}
                />
                <div>
                  <label className={authLabelCls} htmlFor="addr-city">City</label>
                  <input id="addr-city" required className={authInputCls} value={form.city} onChange={set("city")} placeholder="Kathmandu" />
                </div>
                <div className="sm:col-span-2">
                  <label className={authLabelCls} htmlFor="addr-line">Address line</label>
                  <input id="addr-line" required className={authInputCls} value={form.addressLine} onChange={set("addressLine")} placeholder="Street, ward, landmark" />
                </div>
                <div>
                  <label className={authLabelCls} htmlFor="addr-district">District (optional)</label>
                  <input id="addr-district" className={authInputCls} value={form.district ?? ""} onChange={set("district")} placeholder="Lalitpur" />
                </div>
                <div>
                  <label className={authLabelCls} htmlFor="addr-postal">Postal code (optional)</label>
                  <input id="addr-postal" className={authInputCls} value={form.postalCode ?? ""} onChange={set("postalCode")} placeholder="44700" />
                </div>
                <div className="sm:col-span-2">
                  <label className={authLabelCls} htmlFor="addr-notes">Delivery notes (optional)</label>
                  <input id="addr-notes" className={authInputCls} value={form.deliveryNotes ?? ""} onChange={set("deliveryNotes")} placeholder="Call on arrival, gate code…" />
                </div>
                <label className="flex items-center gap-2.5 font-sans text-sm font-light text-muted-foreground sm:col-span-2">
                  <input type="checkbox" checked={!!form.isDefault} onChange={set("isDefault")} className="h-4 w-4 accent-[#B08D46]" />
                  Use as my default delivery address
                </label>
              </div>
              <div className="mt-7 flex gap-4">
                <button
                  type="submit"
                  disabled={busy}
                  className="bg-accent px-8 py-3.5 font-sans text-[0.68rem] uppercase tracking-[0.2em] text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? "Saving…" : editing === "new" ? "Save Address" : "Save Changes"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="border border-border px-8 py-3.5 font-sans text-[0.68rem] uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </AccountLayout>
  );
}
