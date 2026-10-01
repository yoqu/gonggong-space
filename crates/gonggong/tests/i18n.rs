//! Its own process: switching the locale here cannot leak into other tests.
use gonggong::i18n::{Locale, set_locale};
use gonggong::protocol::Approval;
use gonggong::t;

#[test]
fn renders_english() {
    set_locale(Locale::En);
    assert_eq!(gonggong::i18n::tag(), "en");
    assert_eq!(t!("未绑定"), "Not bound");
    assert_eq!(Approval::Ask.label(), "Ask every time");
    assert_eq!(t!("已从 CC Switch 导入 {n} 个供应商", n = 1), "Imported 1 provider from CC Switch");
    assert_eq!(t!("等待回答：{n} 个问题", n = 3), "Awaiting answers: 3 questions");
    set_locale(Locale::Zh);
    assert_eq!(t!("等待回答：{n} 个问题", n = 3), "等待回答：3 个问题");
}
