export function ExpertRulesGuideHe() {
  return (
    <>
      <p>
        כללי מומחה רצים <strong>בתוך הסימולטור</strong> לפני בחירת חיילים. הם דורסים הוגנות רכה אך לא אילוצי YAML קשיחים
        באזורים. אינם מחליפים החלפות ידניות אחרי Generate.
      </p>

      <h3 className="help-subtitle">קריאת מזהים מהמטריצה</h3>
      <ul>
        <li>
          <code>day</code> — יום תכנון מ-0 (כותרת <code>Day 0  Saturday, …</code>)
        </li>
        <li>
          <code>slot</code> — מזהה משבצת מ-1 (כותרת עמודה)
        </li>
        <li>
          <code>shift</code> — בלוק מ-0 (שורה <code>05:00–09:00(0)</code>)
        </li>
        <li>השמיטו <code>shift</code> ל-full_day ו-full_day_team</li>
        <li>
          ב-<code>not</code> / <code>exclude</code> — השמיטו <code>day</code>, <code>slot</code> או <code>shift</code> כדי
          ליישם על <strong>כל</strong> הימים / משבצות / משמרות
        </li>
      </ul>

      <h3 className="help-subtitle">דוגמאות</h3>
      <p>שורה אחת = כלל אחד. העתיקו <code>day</code>, <code>slot</code> ו-<code>shift</code> מ-tooltip התא במטריצה.</p>
      <table className="help-table">
        <thead>
          <tr>
            <th>דוגמה</th>
            <th>משמעות</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>exclude:s34</code>
            </td>
            <td>
              סימון <code>s34</code> כלא זמין לתכנון זה — ללא שיבוץ ביום, משבצת או משמרת. רק ל-proposal; לא משנה סטטוס
              בלשונית חיילים.
            </td>
          </tr>
          <tr>
            <td>
              <code>exclude:s34 day:0</code>
            </td>
            <td>
              כמו למעלה, רק ביום תכנון 0. בלי <code>day</code> — על כל ימי התכנון.
            </td>
          </tr>
          <tr>
            <td>
              <code>not:s3,s1 shift:0</code>
            </td>
            <td>
              הוצאת <code>s3</code> ו-<code>s1</code> ממשמרת 0 ב<strong>כל המשבצות</strong> (ללא <code>slot</code>).
              משפיע על rotating לפי בלוק; full_day משתמש ב-shift -1 ולא נחסם אלא אם מדלגים גם על <code>shift</code>.
            </td>
          </tr>
          <tr>
            <td>
              <code>day:0 slot:1 shift:0 not:s1</code>
            </td>
            <td>
              ביום תכנון 0, חייל <code>s1</code> לא ישובץ למשבצת 1, משמרת 0. שאר החיילים נשארים זמינים למושב זה.
            </td>
          </tr>
          <tr>
            <td>
              <code>day:0 slot:1 shift:2 force:s42</code>
            </td>
            <td>
              ביום 0, ניסיון לשבץ את <code>s42</code> במשבצת 1, משמרת 2. כש-Force <strong>כבוי</strong> (prefer): רק אם
              החייל זמין לפי מנוחה/זמינות; אחרת בחירה הוגנת. כש-Force <strong>דלוק</strong>: שיבוץ בכל מקרה, והחריגות
              מופיעות תחת rule conflicts.
            </td>
          </tr>
          <tr>
            <td>
              <code>slot:2 shift:1 not:s1,s2,s3</code>
            </td>
            <td>
              ב<strong>כל</strong> ימי התכנון (ללא <code>day</code>), הוצאה של <code>s1</code>, <code>s2</code>,{" "}
              <code>s3</code> ממשבצת 2, משמרת 1.
            </td>
          </tr>
          <tr>
            <td>
              <code>day:0 slot:6 shift:4 force_type:H</code>
            </td>
            <td>
              ביום 0, רק חיילים מסוג <code>H</code> יכולים למלא משבצת 6, משמרת 4. למשבצות rotating/windowed — לא
              ל-full_day_team.
            </td>
          </tr>
          <tr>
            <td>
              <code>day:0 slot:10 force_type:E</code>
            </td>
            <td>
              ביום 0, משבצת full_day 10 כולה מתמלאת מחיילים מסוג <code>E</code>. מדלגים על <code>shift</code> כי
              full_day מכסה את כל המשבצת ליום.
            </td>
          </tr>
          <tr>
            <td>
              <code>day:0 slot:8 pin:3</code>
            </td>
            <td>
              ביום 0, משבצת full_day_team 8 מתמלאת רק מפלוגה <code>3</code>, ודורסת את ברירת המחדל{" "}
              <code>pin_platoon</code> ב-YAML.
            </td>
          </tr>
          <tr>
            <td>
              <code>day:0 slot:8 type_remap G&gt;H:2</code>
            </td>
            <td>
              ביום 0, לפני מילוי full_day_team 8: העברת 2 מקומות ממכסת <code>G</code> למכסת <code>H</code>. רק
              ב-full_day_team.
            </td>
          </tr>
        </tbody>
      </table>

      <h3 className="help-subtitle">תיבת Force</h3>
      <table className="help-table">
        <thead>
          <tr>
            <th>מצב</th>
            <th>התנהגות ל-<code>force</code></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>לא מסומן (prefer)</td>
            <td>שיבוץ החייל אם זמין; אחרת הוגנות רגילה</td>
          </tr>
          <tr>
            <td>מסומן (hard)</td>
            <td>
              שיבוץ בכל מקרה אלא אם נחסם ע&quot;י <code>not</code> / <code>exclude</code>; התנגשויות אחרי Generate
            </td>
          </tr>
        </tbody>
      </table>

      <h3 className="help-subtitle">פעולות</h3>
      <ul>
        <li>
          <code>force</code> — שיבוץ חייל (לפי תיבת Force)
        </li>
        <li>
          <code>not</code> — הוצאה מהמאגר (wildcards אופציונליים ל-day / slot / shift)
        </li>
        <li>
          <code>exclude</code> — לא זמין גלובלי לתכנון (<code>exclude:s34</code> = כל הימים, משבצות, משמרות)
        </li>
        <li>
          <code>pin</code> — נעילת פלוגה ב-full_day_team
        </li>
        <li>
          <code>force_type</code> — דרישת סוג ב-rotating / windowed / full_day
        </li>
        <li>
          <code>type_remap</code> — שינוי מכסות ב-full_day_team (<code>G&gt;H:2</code>)
        </li>
      </ul>
    </>
  );
}
