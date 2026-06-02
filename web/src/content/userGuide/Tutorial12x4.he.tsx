export function Tutorial12x4He() {
  return (
    <>
      <p>
        מדריך זה משחזר הגדרת סיבוב מינימלית: <strong>12 חיילים</strong>, <strong>4 משבצות במקביל</strong>, בלוקים של{" "}
        <strong>4 שעות</strong> (6 בלוקים ליום). ליום אחד צפו ל־<strong>24 שיבוצים</strong> (6 × 4).
      </p>

      <h3 className="help-subtitle">הגדרה</h3>
      <ol>
        <li>
          <strong>חיילים:</strong> 12 רשומות, כולם <strong>בבסיס</strong>. מזהים מוצעים: <code>s0</code>…
          <code>s11</code>. שמרו חיילים.
        </li>
        <li>
          <strong>משבצות / אזורים:</strong> <code>shift_hours = 4</code>; סוג משבצת אחד בתבנית <strong>rotating</strong>;
          מיקום אחד (למשל <code>loc_gate</code>); משבצות <code>g1</code>–<code>g4</code> לאותו מיקום. שמרו משבצות.
        </li>
        <li>
          <strong>אזורי זמן:</strong> ברירת מחדל או פסי יום/לילה פשוטים. שמרו אזורי זמן.
        </li>
        <li>
          <strong>גלובלי:</strong> שימו לב לעוגן תכנון ולהיסט יום דיבוג אם משתמשים.
        </li>
        <li>
          <strong>תכנון:</strong> <strong>1</strong> יום, משבצת הצעה <strong>01</strong>. בהגדרות סימולציה, למשל:
          <ul>
            <li>מינימום משמרות פנויות אחרי תורנות: 2</li>
            <li>מינימום שעות פנויות רצופות: 6</li>
            <li>Band relative: 0.2</li>
            <li>Seed אופציונלי לשחזור</li>
          </ul>
          לחצו <strong>צור חדש</strong>.
        </li>
      </ol>

      <h3 className="help-subtitle">קריאת הפתרון (דוח תכנון)</h3>
      <ul>
        <li>
          <strong>מטריצה (קצר / מלא):</strong> שורות = בלוקי זמן, עמודות = משבצות; תא = חייל משובץ; ירוק = לא בתורנות,
          אדום = בתורנות.
        </li>
        <li>
          <strong>לפי חייל:</strong> ציר זמן לכל אדם.
        </li>
        <li>
          <strong>ציר זמן:</strong> תצוגת נתיבים על פני משבצות.
        </li>
        <li>
          <strong>פאנל סטטיסטיקה:</strong> ציון הוגנות (נמוך = הוגן יותר), ממוצעים לפי מיקום ופס זמן, סטטיסטיקת בלוקים
          פנויים.
        </li>
        <li>
          <strong>החלפות ידניות:</strong> שנה חייל בשורה → <strong>החל החלפה</strong> → <strong>שמור הצעה</strong> לפני
          החלה.
        </li>
        <li>
          <strong>PDF / Excel / העתק JSON:</strong> ייצוא לבדיקה (Excel — מטריצה בלבד); לא מפרסם את הלוח.
        </li>
      </ul>

      <p className="contacts-hint">
        הצעה היא <strong>טיוטה</strong> עד <strong>החלה</strong> (ראו תהליך תכנון). סטטיסטיקה משקפת רק תורנויות שהוחלו.
      </p>
    </>
  );
}
