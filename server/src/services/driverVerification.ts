import type { Driver } from '@prisma/client';

type DriverVerificationProfile = Pick<Driver, 'name' | 'tricycle'> & { firstName?: string; lastName?: string; otherNames?: string; dateOfBirth?: Date | null };

export type VerificationDocumentType = 'government_id' | 'drivers_license' | 'vehicle_registration' | 'state_operating_permit' | 'vehicle_inspection_certificate' | 'insurance_certificate' | 'selfie';

export function normalizeValue(value: unknown): string {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function namesEquivalent(left: unknown, right: unknown) {
  const tokens = (value: unknown) => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).sort();
  const a = tokens(left);
  const b = tokens(right);
  return a.length > 0 && a.length === b.length && a.every((token, index) => token === b[index]);
}

export function fullDriverName(driver: DriverVerificationProfile) {
  const parts = [driver.firstName, driver.otherNames, driver.lastName].map(x => String(x || '').trim()).filter(Boolean);
  return parts.join(' ') || driver.name;
}

export async function extractDocumentFields(input: {
  documentType: VerificationDocumentType;
  mimeType: string;
  base64: string;
}) {
  const endpoint = process.env.DOCUMENT_OCR_API_URL;
  if (!endpoint) return { configured: false, fields: null as Record<string, unknown> | null, provider: '' };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.DOCUMENT_OCR_API_KEY) headers.Authorization = `Bearer ${process.env.DOCUMENT_OCR_API_KEY}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Document text extraction service returned ${response.status}`);
  const result = await response.json() as any;
  const fields = result?.fields || result?.data?.fields || result?.data || null;
  return { configured: true, fields: fields && typeof fields === 'object' ? fields as Record<string, unknown> : null, provider: String(result?.provider || 'configured OCR provider') };
}

export function compareDocumentFields(driver: DriverVerificationProfile, documentType: VerificationDocumentType, fields: Record<string, unknown> | null) {
  const checks: Record<string, unknown> = { nameMatch: null, dateOfBirthMatch: null, expiryValid: null, registrationMatch: null, notes: [] as string[] };
  const notes = checks.notes as string[];
  if (!fields) {
    notes.push('Automatic text extraction is not configured; extracted fields need review.');
    return { checks, status: 'needs_review' as const };
  }

  const extractedFirst = String(fields.firstName || fields.first_name || '').trim();
  const extractedLast = String(fields.lastName || fields.last_name || '').trim();
  const extractedOther = String(fields.otherNames || fields.other_names || fields.middleName || fields.middle_name || '').trim();
  const extractedFull = String(fields.fullName || fields.full_name || fields.name || [extractedFirst, extractedOther, extractedLast].filter(Boolean).join(' ')).trim();
  const expectedName = fullDriverName(driver);
  const identityDocument = documentType === 'government_id' || documentType === 'drivers_license';
  if (identityDocument && extractedFull) {
    const nameMatch = namesEquivalent(expectedName, extractedFull);
    checks.nameMatch = nameMatch;
    if (!nameMatch) notes.push('The name read from the document does not match the driver profile.');
  } else if (identityDocument && (extractedFirst || extractedLast)) {
    const firstMatch = !driver.firstName || normalizeValue(extractedFirst) === normalizeValue(driver.firstName);
    const lastMatch = !driver.lastName || normalizeValue(extractedLast) === normalizeValue(driver.lastName);
    checks.nameMatch = firstMatch && lastMatch;
    if (!firstMatch || !lastMatch) notes.push('The name read from the document does not match the driver profile.');
  } else if (identityDocument) {
    notes.push('The OCR service did not return a readable name.');
  }

  const dob = String(fields.dateOfBirth || fields.date_of_birth || fields.dob || '').trim();
  if (dob && driver.dateOfBirth && identityDocument) {
    const parsed = new Date(dob);
    const expectedDob = driver.dateOfBirth;
    const dateMatch = !Number.isNaN(parsed.getTime()) && parsed.getUTCFullYear() === expectedDob.getUTCFullYear() && parsed.getUTCMonth() === expectedDob.getUTCMonth() && parsed.getUTCDate() === expectedDob.getUTCDate();
    checks.dateOfBirthMatch = dateMatch;
    if (!dateMatch) notes.push('The date of birth read from the document does not match the driver profile.');
  } else if (!dob && driver.dateOfBirth && identityDocument) {
    notes.push('The date of birth could not be read from this document.');
  }

  const expiryValue = String(fields.expiryDate || fields.expiry_date || fields.expirationDate || '').trim();
  const expiryRequired = ['drivers_license', 'state_operating_permit', 'vehicle_inspection_certificate', 'insurance_certificate'].includes(documentType);
  if (expiryValue) {
    const expiry = new Date(expiryValue);
    const valid = !Number.isNaN(expiry.getTime()) && expiry.getTime() >= new Date(new Date().toDateString()).getTime();
    checks.expiryValid = valid;
    if (!valid) notes.push('This document appears to be expired or its expiry date could not be read.');
  } else if (expiryRequired) {
    notes.push('The expiry date could not be read automatically; confirm whether this document expires.');
  }

  const registration = String(fields.registrationNumber || fields.registration_number || fields.plateNumber || fields.plate_number || fields.permitNumber || fields.certificateNumber || '').trim();
  if (documentType === 'vehicle_registration' && registration && driver.tricycle) {
    const match = normalizeValue(registration) === normalizeValue(driver.tricycle);
    checks.registrationMatch = match;
    if (!match) notes.push("The vehicle registration number does not match the driver's vehicle profile.");
  }

  const hasHardMismatch = checks.nameMatch === false || checks.dateOfBirthMatch === false || checks.expiryValid === false || checks.registrationMatch === false;
  const hasUnresolved = (identityDocument && (checks.nameMatch === null || (driver.dateOfBirth && checks.dateOfBirthMatch === null))) || (expiryRequired && checks.expiryValid === null) || (documentType === 'vehicle_registration' && checks.registrationMatch === null);
  return { checks, status: hasHardMismatch || hasUnresolved ? 'needs_review' as const : 'checks_passed' as const };
}

export async function verifyAgainstOfficialProvider(documentType: VerificationDocumentType, fields: Record<string, unknown> | null, driver: DriverVerificationProfile) {
  const config = {
    government_id: { url: process.env.GOVERNMENT_ID_VERIFICATION_API_URL, key: process.env.GOVERNMENT_ID_VERIFICATION_API_KEY, name: 'Government ID verification provider' },
    drivers_license: { url: process.env.FRSC_VERIFICATION_API_URL, key: process.env.FRSC_VERIFICATION_API_KEY, name: 'FRSC verification integration' },
    vehicle_registration: { url: process.env.VEHICLE_REGISTRATION_VERIFICATION_API_URL, key: process.env.VEHICLE_REGISTRATION_VERIFICATION_API_KEY, name: 'Vehicle registration verification provider' },
    state_operating_permit: { url: process.env.STATE_PERMIT_VERIFICATION_API_URL, key: process.env.STATE_PERMIT_VERIFICATION_API_KEY, name: 'State permit verification provider' },
    vehicle_inspection_certificate: { url: process.env.VEHICLE_INSPECTION_VERIFICATION_API_URL, key: process.env.VEHICLE_INSPECTION_VERIFICATION_API_KEY, name: 'Vehicle inspection verification provider' },
    insurance_certificate: { url: process.env.VEHICLE_INSURANCE_VERIFICATION_API_URL, key: process.env.VEHICLE_INSURANCE_VERIFICATION_API_KEY, name: 'Vehicle insurance verification provider' },
    selfie: { url: process.env.FACE_VERIFICATION_API_URL, key: process.env.FACE_VERIFICATION_API_KEY, name: 'Face verification provider' },
  }[documentType];
  if (!config.url || !fields) return { configured: false, verified: false, detailsMatch: false, details: null as Record<string, unknown> | null, provider: '', reference: '', message: 'Official verification provider is not configured.' };

  const submittedNumber = String(fields.documentNumber || fields.document_number || fields.licenseNumber || fields.licenceNumber || fields.registrationNumber || fields.registration_number || fields.plateNumber || fields.plate_number || fields.permitNumber || fields.certificateNumber || '').trim();
  const payload = {
    documentType,
    documentNumber: submittedNumber,
    dateOfBirth: fields.dateOfBirth || fields.date_of_birth || fields.dob || (driver.dateOfBirth ? driver.dateOfBirth.toISOString().slice(0, 10) : ''),
    firstName: fields.firstName || fields.first_name || driver.firstName,
    lastName: fields.lastName || fields.last_name || driver.lastName,
    otherNames: fields.otherNames || fields.other_names || driver.otherNames,
    registrationNumber: fields.registrationNumber || fields.registration_number || fields.plateNumber || fields.plate_number || driver.tricycle,
    vin: fields.vin || fields.chassisNumber || fields.chassis_number || '',
  };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.key) headers.Authorization = `Bearer ${config.key}`;
  const response = await fetch(config.url, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`${config.name} returned ${response.status}`);
  const result = await response.json() as any;
  const providerConfirmed = result?.verified === true || result?.data?.verified === true || result?.status === 'verified';
  const details = (result?.data?.details || result?.details || result?.data || {}) as Record<string, unknown>;
  const officialNumber = String(details.documentNumber || details.document_number || details.licenseNumber || details.licenceNumber || details.registrationNumber || details.registration_number || details.plateNumber || details.plate_number || details.permitNumber || details.certificateNumber || '').trim();
  const officialName = String(details.fullName || details.full_name || details.name || [details.firstName || details.first_name, details.otherNames || details.other_names, details.lastName || details.last_name].filter(Boolean).join(' ')).trim();
  const officialDob = String(details.dateOfBirth || details.date_of_birth || details.dob || '').trim();
  const officialRegistration = String(details.registrationNumber || details.registration_number || details.plateNumber || details.plate_number || '').trim();
  const submittedName = fullDriverName(driver);
  const submittedDob = driver.dateOfBirth ? driver.dateOfBirth.toISOString().slice(0, 10) : String(fields.dateOfBirth || fields.date_of_birth || fields.dob || '').slice(0, 10);
  let detailsMatch = false;
  const detailNotes: string[] = [];
  if (documentType === 'government_id' || documentType === 'drivers_license') {
    const numberMatches = Boolean(submittedNumber && officialNumber && normalizeValue(submittedNumber) === normalizeValue(officialNumber));
    const nameMatches = Boolean(officialName && namesEquivalent(officialName, submittedName));
    const officialDate = officialDob ? new Date(officialDob) : null;
    const submittedDate = submittedDob ? new Date(submittedDob) : null;
    const dobMatches = Boolean(officialDate && submittedDate && !Number.isNaN(officialDate.getTime()) && !Number.isNaN(submittedDate.getTime()) && officialDate.toISOString().slice(0, 10) === submittedDate.toISOString().slice(0, 10));
    if (!officialNumber || !submittedNumber) detailNotes.push('Document number was not returned or could not be read.');
    else if (!numberMatches) detailNotes.push('Official document number does not match the uploaded document.');
    if (!officialName) detailNotes.push('Official record did not return the holder name.');
    else if (!nameMatches) detailNotes.push('Official holder name does not match the driver profile.');
    if (!officialDob) detailNotes.push('Official record did not return date of birth.');
    else if (!dobMatches) detailNotes.push('Official date of birth does not match the driver profile.');
    detailsMatch = numberMatches && nameMatches && dobMatches;
  } else if (documentType === 'vehicle_registration') {
    const submittedRegistration = String(payload.registrationNumber || '').trim();
    const registrationMatches = Boolean(submittedRegistration && officialRegistration && normalizeValue(submittedRegistration) === normalizeValue(officialRegistration));
    if (!officialRegistration) detailNotes.push('Official record did not return the vehicle registration number.');
    else if (!registrationMatches) detailNotes.push('Official vehicle registration does not match the submitted vehicle.');
    const submittedVin = String(payload.vin || '').trim();
    const officialVin = String(details.vin || details.chassisNumber || details.chassis_number || '').trim();
    const vinMatches = !submittedVin || Boolean(officialVin && normalizeValue(submittedVin) === normalizeValue(officialVin));
    if (submittedVin && !officialVin) detailNotes.push('Official record did not return the VIN/chassis number.');
    else if (!vinMatches) detailNotes.push('Official VIN/chassis number does not match the submitted document.');
    detailsMatch = registrationMatches && vinMatches;
  } else if (['state_operating_permit', 'vehicle_inspection_certificate', 'insurance_certificate'].includes(documentType)) {
    const submittedExpiry = String(fields.expiryDate || fields.expiry_date || fields.expirationDate || '').trim();
    const officialExpiry = String(details.expiryDate || details.expiry_date || details.expirationDate || '').trim();
    const numberMatches = Boolean(submittedNumber && officialNumber && normalizeValue(submittedNumber) === normalizeValue(officialNumber));
    const submittedExpiryDate = submittedExpiry ? new Date(submittedExpiry) : null;
    const officialExpiryDate = officialExpiry ? new Date(officialExpiry) : null;
    const expiryMatches = !submittedExpiry || Boolean(submittedExpiryDate && officialExpiryDate && !Number.isNaN(submittedExpiryDate.getTime()) && !Number.isNaN(officialExpiryDate.getTime()) && submittedExpiryDate.toISOString().slice(0, 10) === officialExpiryDate.toISOString().slice(0, 10));
    if (!submittedNumber || !officialNumber) detailNotes.push('Permit/certificate number was not returned or could not be read.');
    else if (!numberMatches) detailNotes.push('Official permit/certificate number does not match the uploaded document.');
    if (submittedExpiry && !officialExpiry) detailNotes.push('Official record did not return the expiry date.');
    else if (!expiryMatches) detailNotes.push('Official expiry date does not match the uploaded document.');
    detailsMatch = numberMatches && expiryMatches;
  }
  const verified = providerConfirmed && detailsMatch;
  const message = verified
    ? 'Official record and submitted details match.'
    : !providerConfirmed
      ? String(result?.message || result?.data?.message || 'Official verification did not confirm the document.')
      : detailNotes.join(' ') || 'Official service did not return enough detail to safely confirm this document.';
  return {
    configured: true,
    verified,
    detailsMatch,
    details,
    provider: String(result?.provider || config.name),
    reference: String(result?.reference || result?.data?.reference || result?.requestId || ''),
    message,
  };
}

const BASE_REQUIRED_DOCUMENTS = ['government_id', 'drivers_license', 'vehicle_registration'];
const DOCUMENT_CONFIG: Record<string, { label: string; hint: string; accept: string }> = {
  government_id: { label: 'Government-issued ID', hint: 'NIN slip/card or another accepted government ID', accept: 'image/*,application/pdf' },
  drivers_license: { label: "Driver's licence", hint: 'Upload a clear, unexpired licence belonging to you', accept: 'image/*,application/pdf' },
  vehicle_registration: { label: 'Tricycle registration', hint: 'Registration number must match the vehicle profile', accept: 'image/*,application/pdf' },
  state_operating_permit: { label: 'State operating permit', hint: 'Upload the permit required for your operating state', accept: 'image/*,application/pdf' },
  vehicle_inspection_certificate: { label: 'Vehicle inspection certificate', hint: 'Upload a current inspection certificate if required', accept: 'image/*,application/pdf' },
  insurance_certificate: { label: 'Vehicle insurance certificate', hint: 'Upload valid insurance evidence if required', accept: 'image/*,application/pdf' },
  selfie: { label: 'Selfie for face match', hint: 'A still image alone does not prove liveness; a supported provider is required', accept: 'image/*' },
};
// State-specific requirements are centralised here. Add requirements only after
// confirming the current rules with the relevant state authority.
const STATE_REQUIRED_DOCUMENTS: Record<string, string[]> = {
  ebonyi: BASE_REQUIRED_DOCUMENTS,
};

export function requiredDocumentTypes(state = 'Ebonyi') {
  const stateDocuments = STATE_REQUIRED_DOCUMENTS[state.trim().toLowerCase()] || BASE_REQUIRED_DOCUMENTS;
  return [...stateDocuments, ...(process.env.FACE_VERIFICATION_API_URL ? ['selfie'] : [])];
}

export function getVerificationConfig(state = 'Ebonyi') {
  const required = requiredDocumentTypes(state);
  const optional = process.env.FACE_VERIFICATION_API_URL ? [] : ['selfie'];
  return {
    state,
    requiredDocuments: required.map(type => ({ type, required: true, ...(DOCUMENT_CONFIG[type] || { label: type.replace(/_/g, ' '), hint: 'Upload the required document', accept: 'image/*,application/pdf' }) })),
    optionalDocuments: optional.map(type => ({ type, required: false, ...DOCUMENT_CONFIG[type] })),
    acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    maxFileSizeBytes: 8 * 1024 * 1024,
  };
}

export async function verifyFaceWithProvider(input: {
  selfieBase64: string;
  selfieMimeType: string;
  identityDocumentBase64: string;
  identityDocumentMimeType: string;
}) {
  const endpoint = process.env.FACE_VERIFICATION_API_URL;
  if (!endpoint) return { configured: false, verified: false, provider: '', reference: '', faceMatchPassed: false, livenessPassed: false, message: 'Face matching and liveness provider is not configured.' };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.FACE_VERIFICATION_API_KEY) headers.Authorization = `Bearer ${process.env.FACE_VERIFICATION_API_KEY}`;
  const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(input) });
  if (!response.ok) throw new Error(`Face verification provider returned ${response.status}`);
  const result = await response.json() as any;
  const faceMatchPassed = result?.faceMatchPassed === true || result?.data?.faceMatchPassed === true;
  const livenessPassed = result?.livenessPassed === true || result?.data?.livenessPassed === true;
  const verified = faceMatchPassed && livenessPassed;
  return {
    configured: true,
    verified,
    faceMatchPassed,
    livenessPassed,
    provider: String(result?.provider || 'Face verification provider'),
    reference: String(result?.reference || result?.data?.reference || result?.requestId || ''),
    message: String(result?.message || result?.data?.message || (verified ? 'Face match and liveness passed.' : 'Face match and/or liveness was not confirmed.')),
  };
}
