export function StatsGuideHe() {
  return (
    <>
      <p>
        לשונית <strong>סטטיסטיקה</strong> מציגה את <strong>הלוח המאומת</strong> בלבד — תורנויות שנשמרו אחרי{" "}
        <strong>החלה</strong> בתכנון — לא משבצות הצעת טיוטה.
      </p>
      <ul>
        <li>
          <strong>תאריך סיום</strong> ו<strong>ימים אחורה</strong> מגדירים טווח תאריכים UTC.
        </li>
        <li>
          <strong>תרשים מספר בלוקים:</strong> בלוקי תורנות לחייל בטווח.
        </li>
        <li>מתג אופציונלי <strong>מטריצת ימים</strong> לרשת יומית.</li>
        <li>
          משתמשת באותו <strong>דוח לוח</strong> ו<strong>פאנל סטטיסטיקה</strong> כמו בתכנון, על נתונים היסטוריים.
        </li>
        <li>
          <strong>ייצוא YAML</strong> מוריד את הלוח שהוחל לטווח הנבחר.
        </li>
        <li>
          עם <strong>הצג מטריצת לוח</strong>, <strong>הורד Excel</strong> מייצא רק את המטריצה (שמות מלאים, צבעי תא
          פלוגה) ליום מאומת נבחר.
        </li>
        <li>
          <strong>הסר יום מאומת (מנהל):</strong> מוחק יום לוח אחד מההיסטוריה (עם אישור) כדי לאפשר החלה מחדש לאותו תאריך.
        </li>
      </ul>
      <p className="contacts-hint">אם אין תצוגה — החילו תכנון קודם; מצב ריק = אין שורות מאומתות בטווח.</p>

      <table className="help-table">
        <thead>
          <tr>
            <th>לשונית</th>
            <th>מקור נתונים</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>תכנון</strong>
            </td>
            <td>הצעות טיוטה (משבצות 01–04); עריכה עד החלה</td>
          </tr>
          <tr>
            <td>
              <strong>סטטיסטיקה</strong>
            </td>
            <td>היסטוריית ייצור במסד אחרי החלה</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
