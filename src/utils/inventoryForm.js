import { isValidBox, isValidSize, normalizeBox } from './inventoryRules.js';

export const inventoryFieldError = (field, value, allowDimensions = false) => {
  const text = String(value ?? '').trim();
  if (field === 'type') return !text ? 'Type is required.'
    : ['CVD', 'HP'].includes(text.toUpperCase()) ? '' : 'Select CVD or HP.';
  if (field === 'shape') return text ? '' : 'Shape is required.';
  if (field === 'size') return !text ? 'Size is required.'
    : isValidSize(text, allowDimensions) ? '' : 'Enter a valid positive Size.';
  if (field === 'weight') return !text ? 'Weight is required.'
    : /^\d+(?:\.\d+)?$/.test(text) && Number.isFinite(Number(text)) && Number(text) > 0
      ? '' : 'Enter a valid Weight greater than 0.';
  if (field === 'box') return isValidBox(normalizeBox(text)) ? ''
    : 'Enter a valid Box, for example B29.';
  return '';
};

export const inventorySaveErrorMessage = (error, allowed) => {
  if (!allowed) return 'You do not have permission to add or edit Inventory.';
  if (error?.code === 'permission-denied')
    return 'Inventory could not be saved because access was denied. Please check the account permissions or Inventory security rules.';
  if (['unavailable', 'deadline-exceeded', 'network-request-failed'].includes(error?.code))
    return 'Inventory could not be saved because the connection was interrupted. Please try again.';
  const message = String(error?.message ?? '');
  if (/already exists|duplicate|canonical collision|sku .* exists/i.test(message))
    return 'This Type, Shape and Size already exists in Inventory.';
  if (/identity index is not ready/i.test(message))
    return 'Inventory cannot be saved until the Inventory identity index is ready. Contact an administrator.';
  if (/business data was reset|business system status|business data changed/i.test(message))
    return message;
  return 'Inventory could not be saved. Please try again or contact an administrator.';
};