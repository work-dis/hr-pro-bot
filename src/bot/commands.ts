export const START_COMMAND = "/start";
export const SEARCH_COMMAND = "/search";
export const HISTORY_COMMAND = "/history";
export const HR_COMMAND = "/hr";
export const HR_ADD_VACANCY_COMMAND = "/hr_add";

export const START_MESSAGE =
  "Привет. Я задам несколько коротких вопросов и соберу ваш профиль для подбора вакансий.";

export const QUESTIONS = {
  name: "Как вас зовут?",
  age: "Сколько вам лет?",
  city: "В каком городе вы сейчас находитесь?",
  documents: "Какие документы у вас есть для работы? Напишите через запятую.",
  skills: "Напишите ваши основные навыки или опыт через запятую. Если не хотите заполнять это поле, напишите: нет",
  searchCountry: "Ручной поиск вакансий. Выберите страну кнопкой ниже.",
  searchCity: "Выберите город кнопкой ниже.",
  searchActivity: "Выберите вид деятельности кнопкой ниже.",
} as const;
