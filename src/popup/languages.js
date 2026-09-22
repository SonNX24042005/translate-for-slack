// Searchable target-language catalog based on Google Cloud Translation's published NMT list.

const LANGUAGE_ROWS = [
  ['ab', 'Abkhaz'],
  ['ace', 'Acehnese'],
  ['ach', 'Acholi'],
  ['af', 'Afrikaans'],
  ['sq', 'Albanian'],
  ['alz', 'Alur'],
  ['am', 'Amharic'],
  ['ar', 'Arabic'],
  ['hy', 'Armenian'],
  ['as', 'Assamese'],
  ['awa', 'Awadhi'],
  ['ay', 'Aymara'],
  ['az', 'Azerbaijani'],
  ['ban', 'Balinese'],
  ['bm', 'Bambara'],
  ['ba', 'Bashkir'],
  ['eu', 'Basque'],
  ['btx', 'Batak Karo'],
  ['bts', 'Batak Simalungun'],
  ['bbc', 'Batak Toba'],
  ['be', 'Belarusian'],
  ['bem', 'Bemba'],
  ['bn', 'Bengali'],
  ['bew', 'Betawi'],
  ['bho', 'Bhojpuri'],
  ['bik', 'Bikol'],
  ['bs', 'Bosnian'],
  ['br', 'Breton'],
  ['bg', 'Bulgarian'],
  ['bua', 'Buryat'],
  ['yue', 'Cantonese'],
  ['ca', 'Catalan'],
  ['ceb', 'Cebuano'],
  ['ny', 'Chichewa (Nyanja)'],
  ['zh-CN', 'Chinese (Simplified)'],
  ['zh-TW', 'Chinese (Traditional)'],
  ['cv', 'Chuvash'],
  ['co', 'Corsican'],
  ['crh', 'Crimean Tatar'],
  ['hr', 'Croatian'],
  ['cs', 'Czech'],
  ['da', 'Danish'],
  ['din', 'Dinka'],
  ['dv', 'Divehi'],
  ['doi', 'Dogri'],
  ['dov', 'Dombe'],
  ['nl', 'Dutch'],
  ['dz', 'Dzongkha'],
  ['en', 'English'],
  ['eo', 'Esperanto'],
  ['et', 'Estonian'],
  ['ee', 'Ewe'],
  ['fj', 'Fijian'],
  ['fil', 'Filipino (Tagalog)'],
  ['fi', 'Finnish'],
  ['fr', 'French'],
  ['fr-CA', 'French (Canadian)'],
  ['fy', 'Frisian'],
  ['ff', 'Fulfulde'],
  ['gaa', 'Ga'],
  ['gl', 'Galician'],
  ['lg', 'Ganda (Luganda)'],
  ['ka', 'Georgian'],
  ['de', 'German'],
  ['el', 'Greek'],
  ['gn', 'Guarani'],
  ['gu', 'Gujarati'],
  ['ht', 'Haitian Creole'],
  ['cnh', 'Hakha Chin'],
  ['ha', 'Hausa'],
  ['haw', 'Hawaiian'],
  ['he', 'Hebrew'],
  ['hil', 'Hiligaynon'],
  ['hi', 'Hindi'],
  ['hmn', 'Hmong'],
  ['hu', 'Hungarian'],
  ['hrx', 'Hunsrik'],
  ['is', 'Icelandic'],
  ['ig', 'Igbo'],
  ['ilo', 'Iloko'],
  ['id', 'Indonesian'],
  ['ga', 'Irish'],
  ['it', 'Italian'],
  ['ja', 'Japanese'],
  ['jv', 'Javanese'],
  ['kn', 'Kannada'],
  ['pam', 'Kapampangan'],
  ['kk', 'Kazakh'],
  ['km', 'Khmer'],
  ['cgg', 'Kiga'],
  ['rw', 'Kinyarwanda'],
  ['ktu', 'Kituba'],
  ['gom', 'Konkani'],
  ['ko', 'Korean'],
  ['kri', 'Krio'],
  ['ku', 'Kurdish (Kurmanji)'],
  ['ckb', 'Kurdish (Sorani)'],
  ['ky', 'Kyrgyz'],
  ['lo', 'Lao'],
  ['ltg', 'Latgalian'],
  ['la', 'Latin'],
  ['lv', 'Latvian'],
  ['lij', 'Ligurian'],
  ['li', 'Limburgan'],
  ['ln', 'Lingala'],
  ['lt', 'Lithuanian'],
  ['lmo', 'Lombard'],
  ['luo', 'Luo'],
  ['lb', 'Luxembourgish'],
  ['mk', 'Macedonian'],
  ['mai', 'Maithili'],
  ['mak', 'Makassar'],
  ['mg', 'Malagasy'],
  ['ms', 'Malay'],
  ['ms-Arab', 'Malay (Jawi)'],
  ['ml', 'Malayalam'],
  ['mt', 'Maltese'],
  ['mi', 'Maori'],
  ['mr', 'Marathi'],
  ['chm', 'Meadow Mari'],
  ['mni-Mtei', 'Meiteilon (Manipuri)'],
  ['min', 'Minang'],
  ['lus', 'Mizo'],
  ['mn', 'Mongolian'],
  ['my', 'Myanmar (Burmese)'],
  ['nr', 'Ndebele (South)'],
  ['new', 'Nepalbhasa (Newari)'],
  ['ne', 'Nepali'],
  ['nso', 'Northern Sotho (Sepedi)'],
  ['no', 'Norwegian'],
  ['nus', 'Nuer'],
  ['oc', 'Occitan'],
  ['or', 'Odia (Oriya)'],
  ['om', 'Oromo'],
  ['pag', 'Pangasinan'],
  ['pap', 'Papiamento'],
  ['ps', 'Pashto'],
  ['fa', 'Persian'],
  ['pl', 'Polish'],
  ['pt', 'Portuguese'],
  ['pt-PT', 'Portuguese (Portugal)'],
  ['pt-BR', 'Portuguese (Brazil)'],
  ['pa', 'Punjabi'],
  ['pa-Arab', 'Punjabi (Shahmukhi)'],
  ['qu', 'Quechua'],
  ['rom', 'Romani'],
  ['ro', 'Romanian'],
  ['rn', 'Rundi'],
  ['ru', 'Russian'],
  ['sm', 'Samoan'],
  ['sg', 'Sango'],
  ['sa', 'Sanskrit'],
  ['gd', 'Scots Gaelic'],
  ['sr', 'Serbian'],
  ['st', 'Sesotho'],
  ['crs', 'Seychellois Creole'],
  ['shn', 'Shan'],
  ['sn', 'Shona'],
  ['scn', 'Sicilian'],
  ['szl', 'Silesian'],
  ['sd', 'Sindhi'],
  ['si', 'Sinhala (Sinhalese)'],
  ['sk', 'Slovak'],
  ['sl', 'Slovenian'],
  ['so', 'Somali'],
  ['es', 'Spanish'],
  ['su', 'Sundanese'],
  ['sw', 'Swahili'],
  ['ss', 'Swati'],
  ['sv', 'Swedish'],
  ['tg', 'Tajik'],
  ['ta', 'Tamil'],
  ['tt', 'Tatar'],
  ['te', 'Telugu'],
  ['tet', 'Tetum'],
  ['th', 'Thai'],
  ['ti', 'Tigrinya'],
  ['ts', 'Tsonga'],
  ['tn', 'Tswana'],
  ['tr', 'Turkish'],
  ['tk', 'Turkmen'],
  ['ak', 'Twi (Akan)'],
  ['uk', 'Ukrainian'],
  ['ur', 'Urdu'],
  ['ug', 'Uyghur'],
  ['uz', 'Uzbek'],
  ['vi', 'Vietnamese'],
  ['cy', 'Welsh'],
  ['xh', 'Xhosa'],
  ['yi', 'Yiddish'],
  ['yo', 'Yoruba'],
  ['yua', 'Yucatec Maya'],
  ['zu', 'Zulu']
];

export const LANGUAGE_OPTIONS = Object.freeze(
  LANGUAGE_ROWS.map(([code, name]) => Object.freeze({ code, name }))
);

export function normalizeLanguageSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('vi')
    .trim();
}

export function createLanguageChoices(locale = 'vi') {
  let displayNames = null;
  try {
    displayNames = new Intl.DisplayNames([locale], { type: 'language' });
  } catch {
    // English names remain available when localized names are unsupported.
  }
  const collator = new Intl.Collator(locale, { sensitivity: 'base' });
  return LANGUAGE_OPTIONS.map((language) => {
    let label = '';
    try {
      label = displayNames?.of(language.code) || '';
    } catch {
      // Some runtimes do not recognize every recent BCP-47 language tag.
    }
    if (!label || label.toLocaleLowerCase() === language.code.toLocaleLowerCase()) label = language.name;
    return {
      ...language,
      label,
      searchText: normalizeLanguageSearch(`${label} ${language.name}`)
    };
  }).sort((left, right) => collator.compare(left.label, right.label));
}

export function filterLanguageChoices(choices, query) {
  const normalizedQuery = normalizeLanguageSearch(query);
  if (!normalizedQuery) return Array.from(choices || []);
  return Array.from(choices || []).filter((language) => language.searchText.includes(normalizedQuery));
}

export function resolveLanguageOption(config = {}, options = LANGUAGE_OPTIONS) {
  const code = String(config.targetLanguageCode || '').trim();
  const name = String(config.targetLanguageName || '').trim();
  const byCode = options.find((language) => language.code.toLocaleLowerCase() === code.toLocaleLowerCase());
  if (byCode) return byCode;
  const byName = options.find((language) => language.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (byName) return byName;
  if (code || name) return { code, name: name || code };
  return options.find((language) => language.code === 'vi') || options[0] || { code: 'vi', name: 'Vietnamese' };
}
