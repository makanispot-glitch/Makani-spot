const RENTAL_PERIODS = Object.freeze(['day', 'week', 'month']);
const LISTING_MAX_PRICE = 2147483647;
const LISTING_LABELS = Object.freeze({
  ar: { sale: 'للبيع', rent: 'للإيجار', day: 'يوم', week: 'أسبوع', month: 'شهر', currency: 'ج' },
  en: { sale: 'For sale', rent: 'For rent', day: 'day', week: 'week', month: 'month', currency: 'EGP' },
});

function listingType(listing) {
  return listing?.listing_type === 'rent' ? 'rent' : 'sale';
}

function listingTypeLabel(listing, locale = 'ar') {
  return LISTING_LABELS[locale === 'en' ? 'en' : 'ar'][listingType(listing)];
}

function listingPeriodLabel(period, locale = 'ar') {
  return RENTAL_PERIODS.includes(period) ? LISTING_LABELS[locale === 'en' ? 'en' : 'ar'][period] : '';
}

function listingPriceText(listing, locale = 'ar') {
  if (listing?.price == null || !Number.isFinite(Number(listing.price))) return '\u2014';
  const labels = LISTING_LABELS[locale === 'en' ? 'en' : 'ar'];
  const amount = Number(listing.price).toLocaleString(locale === 'en' ? 'en-US' : 'ar-EG');
  const period = listingType(listing) === 'rent' ? listingPeriodLabel(listing.rental_period, locale) : '';
  return `${amount} ${labels.currency}${period ? ' / ' + period : ''}`;
}

function listingPriceValid(value, type = 'sale') {
  if (value == null || String(value).trim() === '') return false;
  const price = Number(value);
  return Number.isInteger(price) && price >= (type === 'rent' ? 1 : 0) && price <= LISTING_MAX_PRICE;
}

function listingPricingValid(listing) {
  const type = listing.listing_type || 'sale';
  return ['sale', 'rent'].includes(type) && listingPriceValid(listing.price, type) &&
    (type === 'rent' ? RENTAL_PERIODS.includes(listing.rental_period) : listing.rental_period == null);
}

function listingCanComparePrice(type, period) {
  return type === 'sale' || (type === 'rent' && RENTAL_PERIODS.includes(period));
}
