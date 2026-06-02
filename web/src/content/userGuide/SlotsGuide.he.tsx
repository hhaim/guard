export function SlotsGuideHe() {
  return (
    <>
      <p>הגדירו אזורים לפי סדר תלות (כמו בלשונית משבצות):</p>
      <pre className="help-pre">
        {`שעות משמרת (בלוקים 2 / 3 / 4 שעות)
  → סוגי משבצת (תבנית)
    → מיקומי אזור (סוג + משקל)
      → משבצות (משרות במקביל → location_id)`}
      </pre>
      <p>
        לשונית <strong>אזורי זמן</strong> מגדירה פסי הוגנות (<code>from_hour</code>–<code>to_hour</code>,{" "}
        <strong>weight</strong>). משבצות ואזורי זמן נשמרים באותו מסמך אזורים (
        <code>PUT /api/cfg/slots</code>).
      </p>

      <h3 className="help-subtitle">ממשק → YAML (מסמך ושדות משותפים)</h3>
      <p>
        טפסי לשונית משבצות ממופים ישירות למסמך zones ב־YAML/JSON. הגדרות לפי תבנית תחת{" "}
        <code>slots_types[].config</code> אלא אם צוין אחרת.
      </p>
      <table className="help-table">
        <thead>
          <tr>
            <th>בממשק</th>
            <th>מפתח YAML</th>
            <th>הערות</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>שעות משמרת</strong> (ראש הלשונית)
            </td>
            <td>
              <code>shift_hours</code>
            </td>
            <td>2, 3 או 4 — גודל בלוק לוח לסיבוב</td>
          </tr>
          <tr>
            <td>
              סוג משבצת — <strong>שם</strong>, <strong>מזהה</strong>, <strong>תבנית</strong>
            </td>
            <td>
              <code>name</code>, <code>id</code>, <code>pattern</code>
            </td>
            <td>בכל שורת <code>slots_types</code></td>
          </tr>
          <tr>
            <td>
              סוג משבצת — <strong>לא פעיל ב (ימי שבוע)</strong>
            </td>
            <td>
              <code>disabled_weekdays</code>
            </td>
            <td>
              למשל <code>[friday, saturday]</code> — כל התבניות; יום שבוע בתחילת יום תכנון
            </td>
          </tr>
          <tr>
            <td>
              סוג משבצת — <strong>סוגי חיילים מוחרגים</strong>
            </td>
            <td>
              <code>exclude</code>
            </td>
            <td>
              למשל <code>[A, B]</code> — כל התבניות; דורש <code>type_code</code> ברשימה
            </td>
          </tr>
          <tr>
            <td>
              מיקום אזור — שמות, מזהה, סוג, <strong>משקל</strong>
            </td>
            <td>
              <code>zone_loc[]</code>
            </td>
            <td>
              <code>weight</code> משפיע על הוגנות למיקומים מסוג זה
            </td>
          </tr>
          <tr>
            <td>
              שורת משבצת — מיקום, שמות, <strong>מושבת</strong>
            </td>
            <td>
              <code>slots[]</code>
            </td>
            <td>
              <code>location_id</code>, <code>name</code>, <code>full_name</code>, אופציונלי <code>disabled: true</code>
            </td>
          </tr>
          <tr>
            <td>
              שורת משבצת — <strong>חיילים נדרשים</strong>
            </td>
            <td>
              <code>soldiers_required</code>
            </td>
            <td>
              מיקומי <strong>rotating</strong> בלבד; ברירת מחדל <code>1</code>
            </td>
          </tr>
        </tbody>
      </table>

      <h3 className="help-subtitle">השוואת תבניות</h3>
      <table className="help-table">
        <thead>
          <tr>
            <th>תבנית</th>
            <th>שדות בממשק (עורך סוג משבצת)</th>
            <th>התנהגות שיבוץ</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>rotating</strong>
            </td>
            <td>
              תבנית בלבד (ועוד <code>disabled_weekdays</code>, <code>exclude</code> משותפים)
            </td>
            <td>ממלא כל בלוק לוח; חייל אחד לשורת משבצת לבלוק</td>
          </tr>
          <tr>
            <td>
              <strong>full_day</strong>
            </td>
            <td>
              <code>config</code>: start, end, rest, weight, headcount; אופציונלי <code>disabled_weekdays</code> (ללא{" "}
              <code>type_quotas</code>)
            </td>
            <td>
              <code>headcount</code> חיילים ליום לכל שורת משבצת מסוג זה; מסמן עסוק עד אחרי מנוחה
            </td>
          </tr>
          <tr>
            <td>
              <strong>full_day_team</strong>
            </td>
            <td>
              כמו full_day ב־<code>config</code>, בתוספת <code>hours_factor</code>, <code>type_quotas</code>, אופציונלי{" "}
              <strong>נעילת פלוגה</strong> (<code>pin_platoon</code>)
            </td>
            <td>
              ממלא מכסות סוג קודם (המכסה הגדולה ראשונה), אחר כך מקומות כלליים; צוות מאותה פלוגה אופציונלי עם{" "}
              <code>pin_platoon</code>; במטריצה כל השמות בתא
            </td>
          </tr>
          <tr>
            <td>
              <strong>windowed_slots</strong>
            </td>
            <td>
              ברמת סוג: <code>rest_after_hours</code>, <code>full_day_shift</code>; חלונות ב־<code>config</code> +{" "}
              <code>headcount</code>
            </td>
            <td>
              <code>headcount</code> חיילים ליום אחרי בחירת החלון הטוב; אופציונלי <code>disabled_weekdays</code>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="contacts-hint">
        <strong>סוגי חיילים מוחרגים</strong> (<code>exclude</code>) חל על כל תבנית: קודי סוג מסומנים לא יכולים למלא
        משבצת שמיקום האזור שלה משתמש בסוג משבצת זה.
      </p>

      <h3 className="help-subtitle">rotating</h3>
      <p>
        אין בלוק <code>config</code> בעורך סוג המשבצת. הגדירו משרות במקביל תחת <strong>משבצות</strong> עם{" "}
        <code>soldiers_required</code> (ברירת מחדל 1).
      </p>

      <h3 className="help-subtitle">full_day</h3>
      <table className="help-table">
        <thead>
          <tr>
            <th>תווית בממשק</th>
            <th>YAML (<code>config</code>)</th>
            <th>התנהגות</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>התחלה / סיום</td>
            <td>
              <code>start</code>, <code>end</code>
            </td>
            <td>טווח תורנות לפי שעון (<code>HH:00</code>)</td>
          </tr>
          <tr>
            <td>מנוחה אחרי (שעות)</td>
            <td>
              <code>rest_after_hours</code>
            </td>
            <td>תקופת עסוק אחרי סיום תורנות</td>
          </tr>
          <tr>
            <td>מכפיל משקל</td>
            <td>
              <code>weight_multiplier</code>
            </td>
            <td>משקל הוגנות למשרד זה</td>
          </tr>
          <tr>
            <td>כמות כיתה (headcount)</td>
            <td>
              <code>headcount</code>
            </td>
            <td>חיילים משובצים ליום לכל שורת משבצת</td>
          </tr>
        </tbody>
      </table>

      <h3 className="help-subtitle">full_day_team</h3>
      <p>
        כולל את כל שדות <strong>full_day</strong> ב־<code>config</code>, ובנוסף:
      </p>
      <table className="help-table">
        <thead>
          <tr>
            <th>תווית בממשק</th>
            <th>YAML (<code>config</code>)</th>
            <th>התנהגות</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>מקדם שעות (Hours factor)</td>
            <td>
              <code>hours_factor</code>
            </td>
            <td>חלק תורנות מזוכה להוגנות (ברירת מחדל 1); טווח עסוק ללא שינוי</td>
          </tr>
          <tr>
            <td>מכסות סוג (מינימום)</td>
            <td>
              <code>type_quotas</code>
            </td>
            <td>
              למשל <code>{"{A: 1, E: 3}"}</code> — מינימום לפי <code>type_code</code>; סכום ≤ headcount
            </td>
          </tr>
          <tr>
            <td>נעילת פלוגה (פלוגה אחת למשמרת צוות)</td>
            <td>
              <code>pin_platoon: true</code>
            </td>
            <td>
              כל החיילים במשרד באותו יום מאותו <code>platoon_code</code>; הסימולטור מנסה פלוגות לפי התאמה, אחר כך אחרות.
              דורש פלוגה ברשימה.
            </td>
          </tr>
        </tbody>
      </table>
      <p className="contacts-hint">
        בייבוא YAML אפשר <code>features: [pin_platoon]</code> במקום הבוליאני; תיבת הסימון בממשק כותבת{" "}
        <code>pin_platoon: true</code>.
      </p>
      <pre className="help-pre">
        {`- id: team
  pattern: full_day_team
  config:
    start: "09:00"
    end: "17:00"
    rest_after_hours: 6
    weight_multiplier: 1
    headcount: 8
    hours_factor: 0.33
    type_quotas: { A: 1, E: 3 }
    pin_platoon: true`}
      </pre>

      <h3 className="help-subtitle">windowed_slots</h3>
      <table className="help-table">
        <thead>
          <tr>
            <th>תווית בממשק</th>
            <th>YAML</th>
            <th>התנהגות</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>מנוחה אחרי (שעות)</td>
            <td>
              <code>rest_after_hours</code> (על סוג המשבצת)
            </td>
            <td>לא בתוך <code>config</code></td>
          </tr>
          <tr>
            <td>משמרת יום מלא (Full day shift)</td>
            <td>
              <code>full_day_shift</code> (על סוג המשבצת)
            </td>
            <td>אינדקס משמרת לבחירת חלון יום מלא</td>
          </tr>
          <tr>
            <td>כמות כיתה</td>
            <td>
              <code>config.headcount</code>
            </td>
            <td>חיילים ליום אחרי בחירת החלון הטוב</td>
          </tr>
          <tr>
            <td>חלונות — שם, התחלה, סיום, משקל</td>
            <td>
              <code>config.slots[]</code>
            </td>
            <td>
              לכל חלון: <code>name</code>, <code>start</code>, <code>end</code>, <code>weight_multiplier</code>
            </td>
          </tr>
        </tbody>
      </table>

      <p>
        <strong>לא פעיל בימי שבוע:</strong> בכל סוג משבצת, סמנו ימים תחת “לא פעיל ב” ל־<code>disabled_weekdays</code>{" "}
        (למשל <code>friday</code>, <code>saturday</code>). יום השבוע נלקח ב<strong>תחילת יום תכנון</strong> (
        <code>plan_day_start</code> גלובלי, ברירת מחדל 05:00), כך שתורנות 05:00→05:00 למחרת משתמשת ביום השבוע של היום
        הראשון, לא בתאריך לוח אחרי חצות.
      </p>
      <p>
        <strong>משבצת מושבתת:</strong> בכל שורת משבצת, סמנו <strong>מושבת</strong> ל־<code>disabled: true</code>. המשבצת
        נשארת בהגדרה (נשמרת במסד) אך מוחרגת משיבוץ ויצירת תכנון. שורות מושבתות מוצגות עמומות בטבלה. לפחות משבצת אחת
        פעילה חייבת להישאר.
      </p>
      <p>
        <strong>חיילים נדרשים:</strong> בכל שורת משבצת ל־<code>rotating</code> בלבד. <code>full_day</code>,{" "}
        <code>full_day_team</code> ו־<code>windowed_slots</code> משתמשים ב־<code>headcount</code> על סוג המשבצת.
        ברירת מחדל <code>1</code>.
      </p>

      <h3 className="help-subtitle">דוגמאות בממשק (ללא ייבוא)</h3>
      <ul>
        <li>
          <strong>סיבוב בלבד (מדריך):</strong> סוג <code>rotating_slot</code>, מיקום <code>loc_gate</code>, ארבע משבצות{" "}
          <code>g1</code>–<code>g4</code> (כמו בלוק המשבצות ב־<code>zones_s1.yaml</code>).
        </li>
        <li>
          <strong>יום מלא:</strong> מטבח 06:00–22:00 עם 6 שעות מנוחה — כמו שדות <code>full_day_kitchen</code> בדוגמאות
          מעורבות.
        </li>
        <li>
          <strong>חלונות:</strong> שני חלונות ביום — סגנון <code>windowed_hamal</code> (למשל 00:00–12:00 ו־12:00–24:00 עם
          מכפילים שונים).
        </li>
        <li>
          <strong>משרד צוות עם נעילת פלוגה:</strong> <code>full_day_team</code> עם סימון <strong>נעילת פלוגה</strong>;
          שייכו <strong>פלוגה</strong> ברשימת חיילים. ראו דוגמת YAML למעלה.
        </li>
        <li>
          <strong>פריסה מעורבת:</strong> הגדירו מיקומים רבים, אך רק מיקומים שמופיעים ברשימת <strong>משבצות</strong> מתוזמנים
          במקביל.
        </li>
      </ul>

      <p>
        <strong>סדר מילוי</strong> בסימולטור: full_day_team → full_day → windowed_slots → rotating (סיבוב ממלא בלוקים
        שנותרו).
      </p>
      <p className="contacts-hint">
        <strong>זמני שעון</strong> לתבניות יום מלא וחלונות חייבים להיות שעות שלמות (<code>HH:00</code>; לסיום חלון מותר{" "}
        <code>24:00</code>). עורך JSON וטופס סוג משבצת מאמתים לפני שמירה אוטומטית כדי שלא ייכשלו סימולציה ותכנון.
      </p>
      <p className="contacts-hint">
        עריכות משבצות ואזורי זמן נשמרות אוטומטית לאותו מסמך אזורים (<code>PUT /api/cfg/slots</code>).
      </p>
    </>
  );
}
