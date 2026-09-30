// Choice lists mirrored from backend model fields. Keep them in ONE place so
// the registration and settings forms cannot drift apart (a mismatch shows up
// as an opaque 400 from the API).

// CustomUser.gender choices.
export const GENDER_OPTIONS = [
    {value: "M", label: "Male"},
    {value: "F", label: "Female"},
    {value: "O", label: "Other"},
];

// Settings allows clearing the field; registration requires a choice.
export const GENDER_OPTIONS_WITH_UNKNOWN = [...GENDER_OPTIONS, {value: "", label: "Unknown"}];
