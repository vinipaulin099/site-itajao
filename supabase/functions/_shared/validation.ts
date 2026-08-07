import { cleanText, digits, PublicError } from './core.ts';

function validCpf(value: string) {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  const digit = (base: string, factor: number) => {
    let total = 0;
    for (const char of base) total += Number(char) * factor--;
    const result = (total * 10) % 11;
    return result === 10 ? 0 : result;
  };
  return digit(value.slice(0, 9), 10) === Number(value[9]) && digit(value.slice(0, 10), 11) === Number(value[10]);
}

function validCnpj(value: string) {
  if (!/^\d{14}$/.test(value) || /^(\d)\1{13}$/.test(value)) return false;
  const calc = (base: string) => {
    const weights = base.length === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
    const sum = base.split('').reduce((total, char, index) => total + Number(char) * weights[index], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return calc(value.slice(0, 12)) === Number(value[12]) && calc(value.slice(0, 13)) === Number(value[13]);
}

export function validatePostalCode(value: unknown) {
  const postalCode = digits(value);
  if (postalCode.length !== 8) throw new PublicError('CEP inválido.');
  return postalCode;
}

export function validateCustomer(raw: any) {
  const name = cleanText(raw?.name, 120);
  const email = cleanText(raw?.email, 180).toLowerCase();
  const phone = digits(raw?.phone);
  const document = digits(raw?.document);
  if (name.length < 3) throw new PublicError('Informe o nome completo.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PublicError('E-mail inválido.');
  if (phone.length < 10 || phone.length > 11) throw new PublicError('Celular inválido.');
  if (!validCpf(document) && !validCnpj(document)) throw new PublicError('CPF ou CNPJ inválido.');
  return { name, email, phone, document, personType: document.length === 14 ? 'J' : 'F' };
}

export function validateAddress(raw: any) {
  const address = {
    postalCode: validatePostalCode(raw?.postalCode),
    street: cleanText(raw?.street, 160),
    number: cleanText(raw?.number, 20),
    complement: cleanText(raw?.complement, 80),
    district: cleanText(raw?.district, 100),
    city: cleanText(raw?.city, 100),
    state: cleanText(raw?.state, 2).toUpperCase(),
  };
  if (!address.street || !address.number || !address.district || !address.city || !/^[A-Z]{2}$/.test(address.state)) throw new PublicError('Complete o endereço de entrega.');
  return address;
}

export async function lookupCep(postalCode: string) {
  try {
    const response = await fetch(`https://viacep.com.br/ws/${postalCode}/json/`, { headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    const data = await response.json();
    if (data?.erro) return null;
    return { state: String(data.uf || '').toUpperCase(), city: String(data.localidade || '') };
  } catch {
    return null;
  }
}
