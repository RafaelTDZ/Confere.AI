"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  formatCepInput,
  formatCnpjInput,
  parsePartyAddress,
  type PartyAddress,
} from "@/lib/documents/parties-shared";

export type PartyAddressFields = {
  street: string;
  number: string;
  complement: string;
  postalCode: string;
  city: string;
  state: string;
  country: string;
  other: string;
};

export type PartyFieldsValue = {
  name: string;
  cnpj: string;
  address: PartyAddressFields;
};

export function toPartyFieldsValue(party: {
  name: string;
  cnpj: string;
  address: PartyAddress;
}): PartyFieldsValue {
  const address = parsePartyAddress(party.address);
  return {
    name: party.name,
    cnpj: formatCnpjInput(party.cnpj),
    address: {
      street: [address.street, address.number].filter(Boolean).join(", "),
      number: "",
      complement: address.complement ?? "",
      postalCode: formatCepInput(address.postalCode ?? ""),
      city: address.city ?? "",
      state: address.state ?? "",
      country: address.country ?? "",
      other: address.other ?? "",
    },
  };
}

export function PartyFields({
  idPrefix,
  value,
  disabled,
  onChange,
}: {
  idPrefix: string;
  value: PartyFieldsValue;
  disabled?: boolean;
  onChange: (next: PartyFieldsValue) => void;
}) {
  function updateAddress(patch: Partial<PartyAddressFields>) {
    onChange({ ...value, address: { ...value.address, ...patch } });
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-name`}>Nome</Label>
        <Input
          id={`${idPrefix}-name`}
          value={value.name}
          required
          disabled={disabled}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
        />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-cnpj`}>CNPJ</Label>
        <Input
          id={`${idPrefix}-cnpj`}
          value={value.cnpj}
          required
          inputMode="numeric"
          placeholder="00.000.000/0000-00"
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...value, cnpj: formatCnpjInput(event.target.value) })
          }
        />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-street`}>Rua e número</Label>
        <Input
          id={`${idPrefix}-street`}
          value={value.address.street}
          required
          disabled={disabled}
          onChange={(event) => updateAddress({ street: event.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-neighborhood`}>Bairro</Label>
        <Input
          id={`${idPrefix}-neighborhood`}
          value={value.address.other}
          disabled={disabled}
          onChange={(event) => updateAddress({ other: event.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-complement`}>Complemento</Label>
        <Input
          id={`${idPrefix}-complement`}
          value={value.address.complement}
          disabled={disabled}
          onChange={(event) =>
            updateAddress({ complement: event.target.value })
          }
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-cep`}>CEP</Label>
        <Input
          id={`${idPrefix}-cep`}
          value={value.address.postalCode}
          inputMode="numeric"
          placeholder="00000-000"
          disabled={disabled}
          onChange={(event) =>
            updateAddress({ postalCode: formatCepInput(event.target.value) })
          }
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-city`}>Cidade</Label>
        <Input
          id={`${idPrefix}-city`}
          value={value.address.city}
          required
          disabled={disabled}
          onChange={(event) => updateAddress({ city: event.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-state`}>Estado</Label>
        <Input
          id={`${idPrefix}-state`}
          value={value.address.state}
          required
          disabled={disabled}
          onChange={(event) => updateAddress({ state: event.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-country`}>País</Label>
        <Input
          id={`${idPrefix}-country`}
          value={value.address.country}
          required
          disabled={disabled}
          onChange={(event) => updateAddress({ country: event.target.value })}
        />
      </div>
    </div>
  );
}
