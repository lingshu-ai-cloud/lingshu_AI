from __future__ import annotations

from datetime import date
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION_START
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


OUTPUT = Path("/Users/jiejie/Documents/lingshu-AI/output/社媒视频矩阵搭建SOP-V1.0.docx")
TODAY = date(2026, 9, 14)

FONT = "Hiragino Sans GB"
BLACK = "111827"
GRAY = "5B6573"
LIGHT_GRAY = "F5F7FA"
LINE = "D9D9D9"
NAVY = "16324F"
BLUE = "245A8D"
PALE_BLUE = "EEF5FB"
WHITE = "FFFFFF"
GREEN = "256D4A"
PALE_GREEN = "EDF7F1"
AMBER = "9A5A00"
PALE_AMBER = "FFF6E3"
RED = "9B2C2C"
PALE_RED = "FFF0F0"


def set_run(run, size=None, bold=None, color=BLACK, italic=None):
    run.font.name = FONT
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.get_or_add_rFonts()
    for key in ("ascii", "hAnsi", "eastAsia", "cs"):
        rfonts.set(qn("w:" + key), FONT)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic
    if color:
        run.font.color.rgb = RGBColor.from_string(color)


def set_repeat_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    node = OxmlElement("w:tblHeader")
    node.set(qn("w:val"), "true")
    tr_pr.append(node)


def prevent_row_split(row):
    tr_pr = row._tr.get_or_add_trPr()
    node = OxmlElement("w:cantSplit")
    tr_pr.append(node)


def shade(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def cell_margins(cell, top=95, start=130, bottom=95, end=130):
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for key, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        el = tc_mar.find(qn("w:" + key))
        if el is None:
            el = OxmlElement("w:" + key)
            tc_mar.append(el)
        el.set(qn("w:w"), str(value))
        el.set(qn("w:type"), "dxa")


def cell_borders(cell, color=LINE, size=5):
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = tc_pr.first_child_found_in("w:tcBorders")
    if borders is None:
        borders = OxmlElement("w:tcBorders")
        tc_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = borders.find(qn("w:" + edge))
        if el is None:
            el = OxmlElement("w:" + edge)
            borders.append(el)
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), str(size))
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), color)


def set_cell_width(cell, width):
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_w = tc_pr.find(qn("w:tcW"))
    if tc_w is None:
        tc_w = OxmlElement("w:tcW")
        tc_pr.append(tc_w)
    tc_w.set(qn("w:w"), str(width))
    tc_w.set(qn("w:type"), "dxa")


def set_table_layout(table, widths):
    table.autofit = False
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl_pr = table._tbl.tblPr
    tbl_w = tbl_pr.find(qn("w:tblW"))
    if tbl_w is None:
        tbl_w = OxmlElement("w:tblW")
        tbl_pr.append(tbl_w)
    tbl_w.set(qn("w:w"), str(sum(widths)))
    tbl_w.set(qn("w:type"), "dxa")
    layout = tbl_pr.find(qn("w:tblLayout"))
    if layout is None:
        layout = OxmlElement("w:tblLayout")
        tbl_pr.append(layout)
    layout.set(qn("w:type"), "fixed")
    grid = table._tbl.tblGrid
    for child in list(grid):
        grid.remove(child)
    for width in widths:
        node = OxmlElement("w:gridCol")
        node.set(qn("w:w"), str(width))
        grid.append(node)
    for row in table.rows:
        prevent_row_split(row)
        for idx, cell in enumerate(row.cells):
            set_cell_width(cell, widths[min(idx, len(widths) - 1)])
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            cell_margins(cell)
            cell_borders(cell)


def write_cell(cell, text, *, bold=False, color=BLACK, size=9.5, align=None):
    cell.text = ""
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.line_spacing = 1.12
    if align is not None:
        p.alignment = align
    parts = str(text).split("\n")
    for idx, part in enumerate(parts):
        if idx:
            p.add_run().add_break()
        r = p.add_run(part)
        set_run(r, size=size, bold=bold, color=color)


def add_table(doc, headers, rows, widths, *, header_fill=NAVY, first_bold=False, font_size=9.5):
    table = doc.add_table(rows=1, cols=len(headers))
    header = table.rows[0]
    set_repeat_header(header)
    for idx, label in enumerate(headers):
        shade(header.cells[idx], header_fill)
        write_cell(header.cells[idx], label, bold=True, color=WHITE, size=9.4)
    for ridx, values in enumerate(rows):
        row = table.add_row()
        for idx, value in enumerate(values):
            if ridx % 2:
                shade(row.cells[idx], LIGHT_GRAY)
            write_cell(row.cells[idx], value, bold=(first_bold and idx == 0), size=font_size)
    set_table_layout(table, widths)
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(0)
    return table


def add_title(doc, text):
    p = doc.add_paragraph(style="Title")
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    p.paragraph_format.space_after = Pt(10)
    r = p.add_run(text)
    set_run(r, size=26, bold=True, color=BLACK)
    return p


def add_heading(doc, text, level=1, *, page_break=False):
    p = doc.add_paragraph(style=f"Heading {level}")
    p.paragraph_format.space_before = Pt(13 if level == 1 else 9)
    p.paragraph_format.space_after = Pt(5)
    p.paragraph_format.keep_with_next = True
    if page_break:
        p.paragraph_format.page_break_before = True
    r = p.add_run(text)
    set_run(r, size={1: 18, 2: 14, 3: 11.5}.get(level, 11), bold=True, color=BLACK)
    return p


def add_body(doc, text, *, bold_lead=None, color=BLACK, size=10.5, before=0, after=5):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(before)
    p.paragraph_format.space_after = Pt(after)
    p.paragraph_format.line_spacing = 1.28
    if bold_lead and text.startswith(bold_lead):
        r = p.add_run(bold_lead)
        set_run(r, size=size, bold=True, color=color)
        r = p.add_run(text[len(bold_lead):])
        set_run(r, size=size, color=color)
    else:
        r = p.add_run(text)
        set_run(r, size=size, color=color)
    return p


def add_bullet(doc, text, *, level=0, color=BLACK, size=10.3):
    p = doc.add_paragraph(style="List Bullet" if level == 0 else "List Bullet 2")
    p.paragraph_format.left_indent = Inches(0.25 + level * 0.2)
    p.paragraph_format.first_line_indent = Inches(-0.15)
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.line_spacing = 1.2
    r = p.add_run(text)
    set_run(r, size=size, color=color)
    return p


def add_number(doc, text, *, level=0, size=10.3):
    p = doc.add_paragraph(style="List Number" if level == 0 else "List Number 2")
    p.paragraph_format.left_indent = Inches(0.25 + level * 0.2)
    p.paragraph_format.first_line_indent = Inches(-0.15)
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.line_spacing = 1.2
    r = p.add_run(text)
    set_run(r, size=size, color=BLACK)
    return p


def add_label_paragraph(doc, label, text, *, label_color=BLUE):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.line_spacing = 1.25
    r = p.add_run(label + " ")
    set_run(r, size=10.4, bold=True, color=label_color)
    r = p.add_run(text)
    set_run(r, size=10.4, color=BLACK)
    return p


def add_page_field(paragraph):
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    r = paragraph.add_run("灵枢内部策略稿  |  ")
    set_run(r, size=8, color=GRAY)
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = "PAGE"
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    r._r.extend([begin, instr, end])


def add_hyperlink(paragraph, text, url):
    part = paragraph.part
    rid = part.relate_to(url, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", is_external=True)
    hyperlink = OxmlElement("w:hyperlink")
    hyperlink.set(qn("r:id"), rid)
    run = OxmlElement("w:r")
    rpr = OxmlElement("w:rPr")
    rfonts = OxmlElement("w:rFonts")
    for key in ("ascii", "hAnsi", "eastAsia", "cs"):
        rfonts.set(qn("w:" + key), FONT)
    color = OxmlElement("w:color")
    color.set(qn("w:val"), BLUE)
    underline = OxmlElement("w:u")
    underline.set(qn("w:val"), "single")
    rpr.extend([rfonts, color, underline])
    text_node = OxmlElement("w:t")
    text_node.text = text
    run.extend([rpr, text_node])
    hyperlink.append(run)
    paragraph._p.append(hyperlink)
    return hyperlink


def page_break(doc):
    doc.add_page_break()


def configure(doc):
    section = doc.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(0.66)
    section.bottom_margin = Inches(0.64)
    section.left_margin = Inches(0.72)
    section.right_margin = Inches(0.72)
    section.header_distance = Inches(0.28)
    section.footer_distance = Inches(0.3)

    for style_name in ("Normal", "Title", "Heading 1", "Heading 2", "Heading 3", "List Bullet", "List Bullet 2", "List Number", "List Number 2"):
        style = doc.styles[style_name]
        style.font.name = FONT
        rpr = style._element.get_or_add_rPr()
        rfonts = rpr.get_or_add_rFonts()
        for key in ("ascii", "hAnsi", "eastAsia", "cs"):
            rfonts.set(qn("w:" + key), FONT)
        style.font.color.rgb = RGBColor.from_string(BLACK)
        if style_name == "Title":
            ppr = style._element.get_or_add_pPr()
            pbdr = ppr.find(qn("w:pBdr"))
            if pbdr is not None:
                ppr.remove(pbdr)
    doc.styles["Normal"].font.size = Pt(10.5)

    header = section.header.paragraphs[0]
    header.alignment = WD_ALIGN_PARAGRAPH.LEFT
    r = header.add_run("社媒视频矩阵搭建 SOP")
    set_run(r, size=8.2, bold=True, color=BLACK)
    add_page_field(section.footer.paragraphs[0])

    doc.core_properties.title = "社媒视频矩阵搭建SOP"
    doc.core_properties.subject = "按客户画像、目标、平台和账号角色执行视频矩阵"
    doc.core_properties.author = "灵枢AI"
    doc.core_properties.keywords = "社媒矩阵,视频运营,账号角色,拍摄SOP,LinkedIn,YouTube,TikTok,Instagram,Facebook"


def build():
    doc = Document()
    configure(doc)

    # Cover
    add_body(doc, "OPERATING MANUAL  /  SOCIAL VIDEO MATRIX", size=9.5, color=GRAY, after=14)
    add_title(doc, "社媒视频矩阵搭建 SOP")
    add_body(doc, "按客户画像、业务目标、平台和账号角色组织内容、拍摄与运营", size=13, color=BLACK, after=16)
    add_table(doc, ["项目", "口径"], [
        ["版本", f"V1.0  /  {TODAY.isoformat()}"],
        ["适用对象", "B2B获客、已有社媒基础、品牌影响力、渠道招商、DTC直接销售；GEO作为附加层"],
        ["覆盖平台", "LinkedIn、YouTube、TikTok、Instagram、Facebook"],
        ["不包含", "服务商交付排期、合同周期、团队工时承诺"],
        ["核心结论", "先用一个主平台和1—2个账号证明路径，再依据客户自己的业务证据扩号"],
    ], [1650, 7900], first_bold=True, font_size=9.6)
    add_label_paragraph(doc, "重要说明", "平台没有公布适用于所有行业的固定发布频次、固定发布时间或统一成功率。本文件中的账号数、频次、素材数量、复盘窗口和响应时限均标记为【内部建议】，是第一轮测试值，不是平台规则或结果承诺。平台功能和违规边界以文末官方来源为准。")
    add_label_paragraph(doc, "对附件的处理", "保留了“品牌号、垂类或区域号、真人专业号、工厂证明号”的有用思路；删除“先批量开3—5个销售个人号”“前7天固定点赞评论养号”“按月份自动进入爆量”等缺少官方依据或容易触发风险的做法。")

    add_heading(doc, "如何使用这份 SOP", 1, page_break=True)
    add_body(doc, "先做客户归类，再选一个主平台，然后决定账号角色。不要先创建账号，再倒推每个账号讲什么。", bold_lead="先做客户归类，再选一个主平台，然后决定账号角色。")
    for item in [
        "从第1章选一个主要业务目标；同一轮经营只设一个主目标。",
        "用第2章的平台验证表确认目标客户是否真实存在、内容是否拍得出来、客户入口是否可用。",
        "用第3章给每个账号写一张角色卡；两个账号至少在“面向谁、解决什么、由谁表达、用什么证明、把人带到哪里”中有两项不同。",
        "从第4至第8章选择对应客户路线，直接采用账号组合、发布节奏和内容配方。",
        "按照第9章每天采集素材，按照第10章生产和发布，按照第11章处理评论、私信和客户。",
        "用第12章判断保留、重做、扩号、合并或暂停；按第13章排查失败，不用单条爆款做结论。",
    ]:
        add_number(doc, item)
    add_heading(doc, "五条总原则", 2)
    for item in [
        "矩阵是分工，不是同一条视频复制到多个账号。",
        "一个账号只服务一个清楚的人群、一个内容承诺和一个下一步。",
        "先开一个主平台；其他平台只保留品牌名称和基础资料，待主平台跑通后再启用。",
        "每天拍真实问题、真实过程和真实证据；不要依靠AI批量制造高度相似内容。",
        "最终判断以客户对话、销售机会、经销合作或净订单为准，播放和点赞只用于找原因。",
    ]:
        add_bullet(doc, item)

    # 1 Persona routing
    add_heading(doc, "1 客户归类与一页式路线", 1, page_break=True)
    add_body(doc, "客户画像不要只按公司大小划分。先看卖给谁、想得到什么、现在有没有数据和承接能力。一个客户可以有多个标签，但每一轮运营只能选择一个主目标。")
    add_table(doc, ["客户路线", "怎么识别", "主要结果"], [
        ["A B2B从零起步", "卖给企业；海外社媒没有稳定账号、内容或可追踪数据", "目标买家进入会议、报价、寄样或技术确认"],
        ["B B2B已有基础", "已有账号、历史内容和数据，但线索质量或转化不稳定", "修复后产生的销售确认机会，并与自身历史水平比较"],
        ["C1 品牌影响力", "目标市场认识不足、信任不足，购买周期较长", "目标市场主动找品牌、问品牌、引用品牌的合格行为"],
        ["C2 渠道招商", "需要经销商、代理商、零售伙伴或区域合作方", "销售确认的合格渠道机会"],
        ["D DTC直接销售", "用户可以从社媒、店铺或网站直接下单", "社媒带来的净履约订单与净贡献毛利"],
        ["GEO附加层", "希望生成式搜索或AI回答正确提及品牌；可叠加在A—D上", "固定问题集中正确提及、引用及引流；不单独靠多开账号"],
    ], [1750, 4920, 2630], first_bold=True, font_size=9.5)
    add_heading(doc, "一页式起步组合", 2)
    add_table(doc, ["路线", "主平台优先验证", "活跃账号数【内部建议】", "每周发布【内部建议】"], [
        ["A B2B从零起步", "LinkedIn或YouTube；视觉强再测TikTok/Instagram", "1—2个；YouTube先1个频道", "品牌3条；真人/工厂2条；YouTube另按1条长视频/1—2周＋2条Shorts"],
        ["B B2B已有基础", "先审计历史有效平台，不急着换", "收缩到1个主号＋1个辅助号", "主号3条；辅助号2条；重做历史有效主题"],
        ["C1 品牌影响力", "专业复杂用LinkedIn/YouTube；视觉生活方式用Instagram/TikTok", "1—2个", "品牌3—4条；真人2—3条"],
        ["C2 渠道招商", "LinkedIn、YouTube或Facebook；按真实伙伴活动验证", "1—2个", "品牌3条；真实渠道负责人2条"],
        ["D DTC直接销售", "TikTok或Instagram；需搜索/教程时加YouTube", "1—2个", "交易主号5条；创作者/场景号3—4条"],
        ["GEO附加层", "YouTube优先；B2B可配LinkedIn", "默认不新增账号", "1条完整问答/1—2周＋2条短切片"],
    ], [1450, 2820, 1840, 3190], first_bold=True, font_size=8.9)
    add_label_paragraph(doc, "计数说明", "这里只计算持续发布的活跃账号，不计算预留用户名、Facebook Group、YouTube播放列表和员工的普通账号。")

    # 2 Platform selection
    add_heading(doc, "2 平台选择 SOP", 1, page_break=False)
    add_heading(doc, "2.1 先做样本验证", 2)
    add_body(doc, "平台选择不能用“平台大不大”代替。用目标市场的真实样本做一次轻量验证。以下样本量为【内部建议】，不是平台标准。")
    add_table(doc, ["样本", "数量【内部建议】", "要记录什么"], [
        ["目标客户或目标岗位", "30个", "是否有账号；近90天是否活跃；在看、问、分享什么；是否能识别为目标客户"],
        ["同行、经销商或替代方案", "20个", "哪些账号角色持续发布；哪些内容得到目标客户回应；用什么入口承接"],
        ["客户真实问题", "20个", "销售、客服、搜索、展会和评论中反复出现的问题；能否用视频回答并提供证据"],
    ], [2050, 1700, 5560], first_bold=True)
    add_body(doc, "每个平台按五项各打0—2分：目标客户存在、同行有证据、内容拍得出、下一步可用、结果可追踪。总分最高者进入第一轮；若“目标客户存在”“内容拍得出”或“结果可追踪”任一项为0，暂不作为主平台。", bold_lead="每个平台按五项各打0—2分：")
    add_heading(doc, "2.2 平台角色和矩阵结构", 2)
    add_table(doc, ["平台", "更适合的任务", "起步结构", "必须注意"], [
        ["LinkedIn", "B2B获客、专业信任、渠道合作", "1个Company Page＋1个真实创始人/专家；必要时再加真实区域或销售负责人", "个人Profile只能代表真实本人、一个人一个账号且不得共享；企业用Page和管理员权限【P1—P4b】"],
        ["YouTube", "复杂产品说明、教程、案例、比较、长期搜索发现", "先用1个品牌频道分栏目和播放列表；Shorts引起兴趣，长视频解释", "团队用频道权限；不同语言先尝试字幕、翻译和栏目，只有独立受众与维护能力成立才拆频道【P6—P10】"],
        ["TikTok", "DTC演示、真人场景、快速测试创意；少数视觉型B2B", "品牌企业账号＋可选真实员工/创作者或产品场景号", "先核对地区与账号权限；商业内容需披露，音乐需有商业使用权；禁批量账号和假互动【P12—P18】"],
        ["Instagram", "视觉品牌、DTC、人物IP、生活方式、DM咨询", "品牌Business账号＋可选真实Creator/场景号", "通过官方业务资产分配权限；企业音乐库可能受限；合作内容要披露【P19—P23】"],
        ["Facebook", "已有Page、群组、Messenger或本地社区基础", "1个品牌Page；Group作为社区工具；有真实地区差异后再加地区Page", "完整控制权只给客户资产负责人；重复垃圾内容、假互动和低价值搬运会带来触达风险【P24—P27】"],
    ], [1200, 2410, 2950, 2750], first_bold=True, font_size=8.7)
    add_heading(doc, "2.3 不同平台不能照抄同一种矩阵", 2)
    for item in [
        "LinkedIn更像“企业主页＋真实员工网络”。不要创建虚假销售IP，也不要多人轮流扮演同一个个人账号。",
        "YouTube更像“一个频道里的多个栏目”。产品、工厂、案例和问答优先放在一个频道验证，不要一开始每个产品建一个频道。",
        "TikTok和Instagram可以使用“品牌号＋真人/场景测试号”，但两个账号必须有独立表达、独立素材和独立承接。",
        "Facebook优先用Page沉淀官方内容，用Group做讨论；Group不是第二个发布账号，不能用来制造虚假互动。",
        "跨平台可以复用同一次拍摄，但成片要按平台受众和入口重写。仅自动同步同一成片，不视为独立内容实验。",
    ]:
        add_bullet(doc, item)

    # 3 Roles
    add_heading(doc, "3 账号角色库与开号规则", 1, page_break=True)
    add_heading(doc, "3.1 九类账号角色", 2)
    add_table(doc, ["角色", "主要面向谁", "固定讲什么", "下一步"], [
        ["品牌官方号", "所有目标客户、媒体、伙伴", "公司事实、产品价值、重大案例、服务边界", "官网、咨询、店铺或品牌资料"],
        ["创始人或专家号", "决策者、专业人员、潜在伙伴", "判断、方法、答疑、行业变化、真实经历", "评论提问、预约沟通、查看完整资料"],
        ["工厂或证据号", "采购、工程、质量、供应链", "生产、检测、认证、交付、问题处理", "索取规格、样品或质量资料"],
        ["行业或场景号", "某一行业、用途或职业人群", "场景问题、选型、错误、案例、对比", "查看对应方案或案例"],
        ["区域或语言号", "真实不同的国家、语言和服务区域", "当地问题、当地案例、物流、法规与服务", "联系当地团队或地区入口"],
        ["销售或渠道负责人号", "采购、经销商、代理商", "采购问题、合作条件、培训、支持、异议", "预约、报价、伙伴评估"],
        ["产品或交易号", "明确想买某类产品的人", "演示、规格、价格、用法、购买问题", "商品页、店铺、咨询或下单"],
        ["创作者或生活方式号", "消费者或使用者", "真人体验、教程、日常场景、真实反馈", "查看产品、提问或购买"],
        ["直播或活动号", "需要实时讲解、展示、答疑的人", "直播、活动、展会、发布会、培训", "预约直播、留下问题、购买或报名"],
    ], [1700, 2260, 3410, 1940], first_bold=True, font_size=8.9)
    add_heading(doc, "3.2 每个账号必须有一张角色卡", 2)
    add_table(doc, ["字段", "填写要求", "示例"], [
        ["唯一人群", "只写一类主要受众", "德国食品包装设备采购负责人"],
        ["唯一问题", "写清账号长期解决的问题", "如何降低换线停机和清洗时间"],
        ["内容承诺", "用户关注后持续能得到什么", "每周两次真实工厂测试和选型解释"],
        ["表达者", "品牌、真实姓名和职务或明确场景角色", "首席应用工程师Anna"],
        ["证据来源", "产品资料、测试、案例、授权UGC、客户服务记录", "测试编号、日期、参数表、客户授权"],
        ["唯一下一步", "一条内容只要求一个动作", "下载选型表或预约技术确认"],
        ["承接人", "谁在什么时限内处理评论、私信和线索", "欧洲区销售；2个服务小时内接高意向"],
        ["不讲什么", "防止账号越界和互相复制", "不发招聘、泛企业新闻和无关节日内容"],
    ], [1650, 4390, 3270], first_bold=True, font_size=9.0)
    add_heading(doc, "3.3 开新账号的硬条件", 2)
    add_body(doc, "新账号与现有账号必须至少在以下五项中有两项不同：面向谁、解决什么问题、由谁表达、用什么证据、把人带到哪里。仅仅换字幕、封面或视频长度，不构成新账号。", bold_lead="新账号与现有账号必须至少在以下五项中有两项不同：")
    for item in [
        "有真实负责人和官方权限，不靠共享个人密码。",
        "有至少4周独立选题和素材储备【内部建议】。",
        "评论、私信、表单或订单可以独立记录来源。",
        "新增账号不会导致主账号断更或客户回复积压。",
        "每个4周观察窗口最多启用1个新账号【内部建议】。",
    ]:
        add_bullet(doc, item)

    # 4 Persona A
    add_heading(doc, "4 A路线 B2B从零起步", 1, page_break=True)
    add_heading(doc, "4.1 推荐矩阵", 2)
    add_table(doc, ["平台", "起步账号", "复现后可增加", "不建议"], [
        ["LinkedIn", "Company Page＋1个真实创始人/专家，共2个", "真实区域负责人或销售负责人；总计2—4个【内部建议】", "虚构销售身份、多人共用个人号、自动加人与群发"],
        ["YouTube", "1个品牌频道，用播放列表分买家问答、产品演示、工厂、案例", "不同语言有独立受众、团队和内容时再增至2个频道", "每个产品一个频道、多个频道上传同一成片"],
        ["TikTok", "1个品牌企业号；有稳定真人/现场时加1个专家或工厂号", "独立行业或地区需求成立后增至2—3个", "没有真实素材却批量AI铺号"],
        ["Instagram", "1个品牌Business账号；强人物表达时加1个真实Creator账号", "场景或地区账号，总计2—3个", "把员工包装成未披露的普通消费者"],
        ["Facebook", "1个品牌Page；目标客户真正在Group时参与相关讨论", "真实地区差异成立后加地区Page", "先建多个空Page；矩阵互赞互评"],
    ], [1200, 3060, 2830, 2220], first_bold=True, font_size=8.8)
    add_heading(doc, "4.2 发布节奏与内容配方", 2)
    add_label_paragraph(doc, "【内部建议】", "品牌主号每周3个独立主题；专家或工厂号每周2个独立主题。YouTube频道每1—2周1条完整解释视频，同时每周2条Shorts。先保持4周，再根据客户自己的数据调整。")
    add_table(doc, ["每10条内容", "条数【内部建议】", "题目例子"], [
        ["买家常见问题", "3", "交期为什么变化；如何选规格；是否支持OEM"],
        ["工厂、检测、认证、研发或交付证据", "3", "一次真实检测；不合格品怎么处理；包装前检查"],
        ["应用、选型、比较或常见错误", "2", "三种材料分别适合什么；采购最容易漏掉的参数"],
        ["真实案例", "1", "问题—方法—证据—结果；必须获授权或匿名"],
        ["团队或品牌", "1", "工程师为什么坚持某项标准；售后如何接问题"],
    ], [3100, 1900, 4310], first_bold=True, font_size=9.1)
    add_heading(doc, "4.3 每日素材优先级", 2)
    for item in [
        "1个采购或工程问题：由销售复述客户原话，保留国家、岗位、用途和限制。",
        "1个专家完整回答：问题、直接答案、原因、证据、适用与不适用情况、下一步。",
        "1组过程或检测证据：全景、动作中景、参数近景、结果、人员解释。",
        "1个交付或服务动作：包装、出库、远程指导、售后排查；隐藏客户隐私。",
        "1个可追溯编号：产品、测试、资料或案例编号，供脚本和审核查证。",
    ]:
        add_bullet(doc, item)
    add_heading(doc, "4.4 达成目标依赖路径", 2)
    add_body(doc, "真实买家问题 → 品牌或专家给出清楚答案 → 工厂、测试、案例提供证据 → 内容给出一个咨询动作 → 评论或私信被识别 → 销售确认需求 → 会议、报价、样品或技术确认 → 结果回写到下一轮选题。")
    add_label_paragraph(doc, "主要结果", "滚动90天内由社媒内容带来的销售确认机会数。若客户暂时没有销售系统，先记录有效询盘数，以及进入会议、报价、寄样或技术确认的人数。90天是【内部建议】；若客户销售周期更长，必须覆盖至少一个真实销售周期。")

    # 5 Persona B
    add_heading(doc, "5 B路线 B2B已有社媒基础", 1, page_break=True)
    add_body(doc, "第一步不是新建更多账号，而是把现有账号分成保留、调整、合并候选、暂停和待观察。主账号不按粉丝数决定，而按账号控制权、目标客户反应、内容供给、询盘可追踪和风险情况决定。")
    add_heading(doc, "5.1 账号审计", 2)
    add_table(doc, ["检查对象", "检查内容", "处理动作"], [
        ["账号与权限", "所有权、管理员、双重验证、离职人员、平台警告、版权", "先修安全；风险未解不发布"],
        ["近8—12周内容【内部建议】", "按问答、案例、产品、工厂、人物分类；看中位表现，不用最高播放代表水平", "找可重做主题和长期低质主题"],
        ["近90—180天客户记录【内部建议】", "去除员工、机器人、重复联系人和垃圾信息；尽量对应到账号和内容", "形成客户自己的参照水平"],
        ["账号重叠", "人群、问题、出镜人、证据、下一步是否相同", "保留1个主号；重复号降频或合并"],
        ["承接链路", "评论、私信、表单、网站、CRM、订单是否能回写", "修好入口再开始新测试"],
    ], [1900, 4960, 2450], first_bold=True, font_size=9.2)
    add_heading(doc, "5.2 推荐矩阵和节奏", 2)
    add_label_paragraph(doc, "【内部建议】", "首轮只运营1个主号＋1个辅助验证号。主号每周3条，辅助号每周2条；其他账号低频维护或暂停，不立即删除。")
    add_table(doc, ["内容来源", "占比【内部建议】", "做法"], [
        ["历史曾吸引目标客户的主题", "50%", "换证据、开头或表达重新制作；一次只改一个主要因素"],
        ["缺失的信任证据", "30%", "补案例、测试、技术、履约和真人解释"],
        ["新问题或新场景", "20%", "来自当前销售、客服、评论和搜索问题"],
    ], [2740, 1900, 4670], first_bold=True)
    add_heading(doc, "5.3 每日素材优先级", 2)
    for item in [
        "把当天新客户问题、销售异议和未成交原因各录1条语音或短视频。",
        "为一个历史有效主题补拍新的证明镜头，避免只换字幕重复发布。",
        "核对一个旧内容中的产品、数字、证书、链接或人员信息是否已过期。",
        "为主号优先补素材；只有主号下两周内容充足时，才给辅助号拍独立素材。",
    ]:
        add_bullet(doc, item)
    add_label_paragraph(doc, "主要结果", "仍看销售确认机会；同时比较修复后与客户自己的同长度历史水平，避免拿不同行业的公开平均值做承诺。")

    # 6 C1
    add_heading(doc, "6 C1路线 品牌影响力", 1, page_break=True)
    add_heading(doc, "6.1 推荐矩阵", 2)
    add_table(doc, ["业务特征", "主平台判断", "起步账号", "复现后"], [
        ["专业、复杂、长决策", "LinkedIn＋YouTube择一为主，另一个作内容资料库", "品牌号＋真实创始人/专家，共1—2个", "增加案例/场景或地区角色，总计2—3个"],
        ["视觉、设计、生活方式", "Instagram或TikTok择一为主", "品牌号＋真实人物/创作者，共1—2个", "增加产品场景或地区号，总计2—3个"],
        ["本地社区和长期关系", "Facebook Page；必要时配Group", "1个品牌Page", "真实地区服务不同再加地区Page"],
    ], [2200, 2660, 2500, 1950], first_bold=True, font_size=9.0)
    add_heading(doc, "6.2 发布节奏与内容配方", 2)
    add_label_paragraph(doc, "【内部建议】", "品牌号每周3—4条，专家或人物号每周2—3条；地区号只有当地语言、案例和服务人员都独立时才启用，每周2—3条本地化内容。")
    add_table(doc, ["每10条内容", "条数", "必须呈现"], [
        ["独特观点或方法", "3", "对一个真实问题给出有边界的判断"],
        ["产品、组织或技术证据", "2", "演示、流程、研发、测试、服务"],
        ["案例或应用", "2", "问题、做法、证据、结果和限制"],
        ["专家、员工或幕后", "2", "真实人员、真实职责、真实工作"],
        ["明确下一步", "1", "查看资料、订阅栏目、咨询或参加活动"],
    ], [3080, 1300, 4930], first_bold=True)
    add_heading(doc, "6.3 每日素材优先级", 2)
    for item in [
        "1个品牌判断：为什么这样做、适用于谁、不适用于谁。",
        "1个独特方法：流程中的一个具体步骤、标准或取舍。",
        "1个真实人物：一句工作判断＋对应动作，不拍空泛口号。",
        "1组幕后证据：会议准备、产品改进、培训、客户支持或问题修复。",
        "1个一致性核对：视频口播、字幕、官网和产品资料中的名称与事实是否一致。",
    ]:
        add_bullet(doc, item)
    add_label_paragraph(doc, "主要结果", "目标市场中主动找品牌、问品牌或进入品牌资料的合格行为。需要先定义“合格”：来自目标国家和目标人群，且能被账号、网站或销售记录识别。不要只用总曝光或粉丝数。")

    # 7 C2
    add_heading(doc, "7 C2路线 渠道招商", 1, page_break=True)
    add_heading(doc, "7.1 推荐矩阵", 2)
    add_table(doc, ["平台", "起步角色", "适用条件"], [
        ["LinkedIn", "Company Page＋真实渠道负责人", "可以按公司、职位找到经销或零售决策者"],
        ["YouTube", "1个品牌频道中的伙伴培训、演示、案例栏目", "伙伴需要持续学习产品、安装、销售和售后"],
        ["Facebook", "品牌Page＋可选伙伴Group", "目标市场存在活跃地区社区、行业群或Messenger承接"],
        ["Instagram/TikTok", "品牌号＋真实渠道负责人或零售场景号", "零售商、买手或分销商确实在视觉平台活跃"],
    ], [1500, 4200, 3610], first_bold=True, font_size=9.3)
    add_label_paragraph(doc, "【内部建议】", "起步1—2个账号；品牌号每周3条，渠道负责人每周2条。只有一个地区反复出现独立伙伴需求、当地政策和服务都不同，才增加地区号。")
    add_heading(doc, "7.2 每10条内容配方", 2)
    add_table(doc, ["主题", "条数【内部建议】", "内容"], [
        ["市场机会或客户需求", "2", "哪些终端问题正在出现；不能夸大市场数据"],
        ["什么伙伴适合或不适合", "2", "区域、渠道、客户类型、能力和投入条件"],
        ["产品与供货", "2", "核心产品、备货、交期、起订、包装、质量"],
        ["培训、素材、服务与售后支持", "2", "总部具体提供什么，不做空泛承诺"],
        ["真实伙伴案例", "1", "获授权；无授权则匿名且不编造结果"],
        ["申请流程", "1", "需要哪些信息、谁审核、下一步是什么"],
    ], [3060, 1900, 4350], first_bold=True, font_size=9.1)
    add_heading(doc, "7.3 每日素材优先级", 2)
    for item in [
        "1个真实合作问题：区域保护、起订、样品、培训、物料、售后或交付。",
        "1个总部支持动作：培训片段、销售工具、样品准备、技术答疑、售后排查。",
        "1份当地材料：当地语言、价格适用范围、物流或法规资料；发布前确认仍有效。",
        "1个伙伴案例证据：经授权的数据、门店、陈列、活动或结果；未授权则只讲匿名流程。",
    ]:
        add_bullet(doc, item)
    add_label_paragraph(doc, "主要结果", "销售确认的合格渠道机会数。合格至少包括真实公司、目标地区、经营品类、渠道类型、客户群、服务能力和明确下一步。")

    # 8 DTC and GEO
    add_heading(doc, "8 D路线 DTC直接销售与GEO附加层", 1, page_break=True)
    add_heading(doc, "8.1 DTC推荐矩阵", 2)
    add_table(doc, ["平台", "起步账号", "复现后", "启用前条件"], [
        ["TikTok", "品牌交易主号＋可选真实创作者/产品场景号", "产品/场景、创作者、直播或地区号，总计2—5个【内部建议】", "核对地区商业功能；库存、客服、履约、退换货和音乐授权可承接"],
        ["Instagram", "品牌Business号＋可选真实Creator/场景号", "产品场景、创作者或地区号，总计2—5个", "视觉素材、Stories、DM和WhatsApp/网站入口可承接"],
        ["YouTube", "1个品牌频道；Shorts＋完整评测/教程", "独立语言或人群成立后增至2个频道", "能持续做搜索型教程、比较、安装或长期使用内容"],
        ["Facebook", "1个Page；有社区基础时配Group", "真实地区Page或直播角色", "目标客户确实活跃在Page、Group或Messenger"],
        ["LinkedIn", "通常不作为普通消费品主平台", "企业采购或职场人群本身是买家时另行验证", "不可因为账号现成就强行承担DTC成交"],
    ], [1200, 2580, 2870, 2660], first_bold=True, font_size=8.7)
    add_heading(doc, "8.2 DTC发布与内容配方", 2)
    add_label_paragraph(doc, "【内部建议】", "品牌交易主号每周5条；创作者或场景号每周3—4条；成熟前同时活跃不超过3个账号。直播号只有主播、库存、客服、发货和售后都能承接时启用。")
    add_table(doc, ["每10条内容", "条数", "拍什么"], [
        ["真实演示", "3", "开箱、安装、使用、清洁、结果；保留失败或限制说明"],
        ["使用场景或前后变化", "2", "同一条件下拍摄；不能制造虚假前后对比"],
        ["购买问题", "2", "尺寸、规格、价格、物流、适用与不适用人群"],
        ["授权UGC", "1", "真实用户、授权范围、合作披露"],
        ["比较或选购", "1", "明确比较条件，不贬损、不虚构竞品"],
        ["优惠或商品动作", "1", "库存、价格、有效期、地区和退换规则可核对"],
    ], [2990, 1200, 5120], first_bold=True)
    add_heading(doc, "8.3 DTC每日素材优先级", 2)
    for item in [
        "同一产品拍3个不同开头：问题开头、结果开头、场景开头。",
        "1次完整演示：从拿起产品到结果，不用剪辑掩盖关键步骤。",
        "1个使用场景：谁、在什么地方、为什么需要、结果怎样。",
        "1个购买异议：价格、尺寸、效果、物流、退换或耐用性；用真实事实回答。",
        "1个结果镜头和1个限制说明：让内容更可信，也降低售后预期差。",
    ]:
        add_bullet(doc, item)
    add_label_paragraph(doc, "主要结果", "社媒归因的净贡献毛利；前置看净履约订单。净贡献毛利应扣除商品成本、退款退货、履约和平台等可变成本，公式由客户财务确认。")
    add_heading(doc, "8.4 GEO作为附加层", 2)
    add_body(doc, "GEO不默认增加账号。它给品牌号、专家号和YouTube问答栏目增加“事实一致、来源清楚、回答完整、长期可访问”的要求。社媒内容不能保证任何生成式系统抓取、引用或推荐品牌。")
    for item in [
        "品牌中英文名称、公司、产品、地点、创始人、资质和日期保持一致。",
        "每条专业观点有真实作者；重要数字、认证和案例能指回来源。",
        "一个视频完整回答一个具体问题；口播、字幕、文案和官网事实一致。",
        "YouTube每1—2周1条完整问答，并衍生2条Shorts【内部建议】；B2B可在LinkedIn由真实专家再解释。",
        "固定一组买家问题，定期检查品牌是否被正确提及、引用来源是否正确、是否带来访问；问题集和检查周期由客户确认。",
    ]:
        add_bullet(doc, item)

    # 9 shooting
    add_heading(doc, "9 每日素材拍摄 SOP", 1, page_break=True)
    add_heading(doc, "9.1 每个拍摄工作日的最低素材包", 2)
    add_label_paragraph(doc, "【内部建议】", "下面是素材数量，不是每天必须发布的成片数量。每天小批量采集，统一进入素材库；剪辑可集中进行。")
    add_table(doc, ["素材", "数量", "拍摄要求", "可供哪些账号使用"], [
        ["真人完整回答", "1条", "问题、答案、原因、证据、适用边界、下一步", "专家、品牌、销售、GEO"],
        ["15秒短回答", "1条", "只保留问题、结论和一个证据", "TikTok、Reels、Shorts、LinkedIn"],
        ["场景全景", "1条", "交代人、地点、设备或使用环境", "品牌、工厂、场景"],
        ["工作中景", "2条", "真实动作连续；每条前后多留5秒【内部建议】", "工厂、产品、幕后"],
        ["手部、产品、参数近景", "3条", "对焦清楚；数字、单位和标签可读", "所有证明型内容"],
        ["结果镜头", "1条", "在同样条件下拍结果；不夸大", "案例、演示、DTC"],
        ["可核对证据", "1条", "测试读数、报告局部、批次、证书适用范围或授权", "品牌、专家、工厂、GEO"],
        ["自然人物或团队", "1条", "真实职责和动作，不排演虚假客户", "品牌、人物、幕后"],
    ], [1780, 950, 4200, 2380], first_bold=True, font_size=8.8)
    add_heading(doc, "9.2 七天主题轮值表", 2)
    add_table(doc, ["日", "主拍主题", "必须拍到", "不同客群加拍"], [
        ["周一", "客户问题", "3个真实问题；每题完整回答、短答、适用/不适用", "B2B加采购参数；DTC加购买异议；渠道加合作条件"],
        ["周二", "产品与过程", "全景、开始动作、手部/机器、参数、变化、结果、操作者解释", "B2B拍原料/工序；DTC拍开箱/安装/清洁"],
        ["周三", "质量与信任", "真实检测、读数、合格/不合格、包装、批次、人员解释", "品牌拍研发标准；渠道拍供货与售后"],
        ["周四", "场景与案例", "问题—方法—证据—结果；使用、安装或交付过程", "无客户授权时匿名；重演必须标“场景演示”"],
        ["周五", "人物与经营", "人物职责、工作判断、学习、改进、支持动作", "品牌加观点；渠道加伙伴支持；B2B加专家答疑"],
        ["周六", "真人使用与UGC", "不同真实用户、场景、教程、错误、评论回复", "DTC重点；员工出镜须披露身份，不冒充普通消费者"],
        ["周日", "整理与补拍", "上传、命名、查漏、补焦点/声音/细节、确认授权", "确认下周人物、产品、场地、安全和禁拍清单"],
    ], [760, 1650, 4110, 2790], first_bold=True, font_size=8.7)
    add_heading(doc, "9.3 开机前和每个场景的标准动作", 2)
    add_table(doc, ["环节", "检查清单"], [
        ["开机前", "擦镜头；电量与存储；关闭通知；先测声音；确认场地和人物授权；检查背景中的客户资料、地址、屏幕、订单和密码；确认安全装备；商业音乐留到剪辑阶段核权"],
        ["每个场景", "先全景，再中景，再动作近景、关键细节、结果、人物解释；每个关键动作拍两遍；不要数字变焦；镜头前后留停顿；同时为竖版和横版留裁切空间"],
        ["真人回答", "目标人群的问题 → 直接答案 → 原因 → 证据或例子 → 适用边界 → 一个下一步；录完整版本、短版本和一个备用开头"],
        ["发生口误", "从完整句子重新录，不用在关键数字中间硬剪；数字、规格、单位和专有名词单独再录一次"],
        ["客户案例", "先确认书面授权范围；无授权则去名、去Logo、去地址和敏感数字；不能把场景重演说成真实客户结果"],
    ], [1800, 7510], first_bold=True, font_size=9.2)
    add_heading(doc, "9.4 一次事件如何供给多个账号", 2)
    add_body(doc, "同一次真实耐温测试可以产生多条不同内容，但不是复制同一成片：")
    add_table(doc, ["账号", "讲法", "证据", "下一步"], [
        ["品牌号", "为什么这项测试与交付承诺有关", "标准、设备、完整过程", "查看质量资料"],
        ["工厂号", "测试每一步怎么做", "读数、时间、合格/不合格样本", "索取测试报告"],
        ["专家号", "买家怎样判断这个参数", "选择条件、例外和常见错误", "提交应用参数"],
        ["场景号", "某行业使用时会遇到什么风险", "场景、结果和限制", "查看行业方案"],
        ["销售号", "报价或寄样前为什么要先确认该参数", "需求表和沟通步骤", "预约技术确认"],
    ], [1500, 3340, 2620, 1850], first_bold=True, font_size=9.1)
    add_heading(doc, "9.5 素材命名和目录", 2)
    add_body(doc, "文件名【内部标准】：日期_平台_账号角色_市场语言_产品_主题_镜头类型_版本_授权状态。例：20260914_LinkedIn_专家号_DE-EN_X200_耐温测试_近景_T01_已授权.mp4。")
    add_table(doc, ["目录", "放什么"], [
        ["01 品牌与产品资料", "批准的品牌名、产品参数、证书、FAQ、禁用词"],
        ["02 原始素材", "按日期、人物、产品、过程、案例分层"],
        ["03 待确认", "事实、人物、客户、音乐或使用权待确认"],
        ["04 剪辑中", "工程文件、字幕、配音、封面"],
        ["05 已批准", "完成事实、品牌、合规和权利审核的成片"],
        ["06 已发布", "成片、平台链接、内容ID、发布日期、截图"],
        ["07 禁止使用", "客户撤权、过期事实、侵权、隐私、错误版本"],
        ["08 授权与来源", "授权书、原始来源、许可范围、到期日"],
    ], [2250, 7060], first_bold=True)

    # 10 production and publishing
    add_heading(doc, "10 内容生产与发布 SOP", 1, page_break=True)
    add_heading(doc, "10.1 一条视频的最小结构", 2)
    add_body(doc, "每条内容只解决一个问题，只使用能核对的事实，只给一个下一步。")
    add_table(doc, ["段落", "任务", "内部制作参考"], [
        ["开头", "让目标人群立刻知道这是自己的问题", "短视频前3秒直接给问题、结果或场景；不是平台规则"],
        ["直接答案", "先说结论，不绕品牌历史", "1—2句话"],
        ["解释", "说明为什么、怎么做、何时不适用", "用口语；每句只放一个信息"],
        ["证据", "展示测试、过程、案例、实物或真实人员", "数字、单位、日期和来源可核对"],
        ["下一步", "只要求一个动作", "评论提问、看长视频、下载资料、私信、预约或购买择一"],
    ], [1500, 4390, 3420], first_bold=True, font_size=9.2)
    add_heading(doc, "10.2 内容时长作为制作测试值", 2)
    add_table(doc, ["类型", "时长【内部建议】", "适用"], [
        ["短答", "15—30秒", "一个结论＋一个证据；评论回复、Shorts、Reels、TikTok"],
        ["标准短视频", "30—60秒", "一个问题、解释、证据、下一步"],
        ["深入短视频", "60—180秒", "演示、比较、选型、案例；以平台当期上传能力为准"],
        ["YouTube完整解释", "4—8分钟", "教程、测试、案例、采购问答；问题复杂时可更长"],
    ], [2150, 2050, 5110], first_bold=True)
    add_label_paragraph(doc, "注意", "时长不是质量门槛。以客户自己的观看留存、目标人群反应和下一步结果判断。YouTube、LinkedIn、TikTok和Meta的上传能力会更新，发布前以账号当期界面和官方说明为准。")
    add_heading(doc, "10.3 同素材跨平台改写", 2)
    add_table(doc, ["平台", "成片重点", "下一步设计"], [
        ["LinkedIn", "真人专业判断、业务背景、可讨论的问题；公司Page与真人Profile采用不同角度", "Page放网站/联系入口；个人先公开回答，涉及报价和联系方式再转私下。Page不能主动给未先发消息的人群发【P3】"],
        ["YouTube", "Shorts提出问题或展示结果；长视频完整解释；标题明确问题而非堆关键词", "Shorts描述和评论中的网址不可点击；用相关视频、频道资料或长视频描述承接【P9】"],
        ["TikTok", "真人、动作、场景和结果靠前；商业内容披露与音乐权限完成", "先确认账号和地区是否有网站、表单、店铺或私信能力【P14—P17】"],
        ["Instagram", "Reels做发现，Stories做日常和互动，DM或业务入口承接", "合作、赠品或联盟内容按要求标识；企业音乐按授权使用【P21—P23】"],
        ["Facebook", "Page发布原生视频/Reels；社区问题可在Group以真实身份回答", "Page行动按钮、Messenger或网站；不使用无关长文案和过量标签【P25—P27】"],
    ], [1300, 3910, 4100], first_bold=True, font_size=8.8)
    add_heading(doc, "10.4 发布前15项检查", 2)
    checklist = [
        "账号角色正确；不是为了填日历而发无关内容。",
        "目标人群在开头能听懂“这是给谁的”。",
        "只回答一个主要问题。",
        "标题、封面和开头与实际内容一致。",
        "产品、数字、规格、证书和案例均有来源。",
        "没有“最好、百分百、保证”等无法证明的表述。",
        "人物、客户、场地、UGC、图片、字体和音乐权利明确。",
        "没有暴露姓名、地址、订单、价格、密码、未发布规格或其他隐私。",
        "字幕、姓名、数字、单位、语言和地区写法正确。",
        "只有一个清楚的下一步。",
        "链接、表单、店铺、邮箱、WhatsApp或联系人已真实测试。",
        "封面不是夸张或虚假的结果图。",
        "内容ID、素材ID和账号ID已登记。",
        "审批人、版本和日期已记录。",
        "评论、私信、订单或线索的承接人已排班。",
    ]
    for item in checklist:
        add_bullet(doc, "□ " + item)
    add_heading(doc, "10.5 发布后立即检查与数据快照", 2)
    for item in [
        "打开实际页面，检查视频、声音、字幕、封面、链接、商品和披露是否正确。",
        "保存URL、发布时间、平台内容ID和截图，并与内部内容ID绑定。",
        "事实、版权、隐私、库存或履约出现问题时，先暂停或更正，不等待数据变好。",
        "在发布后24小时、72小时和7天保存快照【内部建议】；这只是统一比较窗口，不是所谓算法黄金时间。",
        "记录展示或观看、观看深度、互动、主页/链接/商品动作、评论、私信、合格客户、销售或订单结果。不同平台的指标定义不同，不直接相加。",
    ]:
        add_bullet(doc, item)

    # 11 operating rhythm
    add_heading(doc, "11 日常运营、评论私信与客户承接", 1, page_break=True)
    add_heading(doc, "11.1 每个工作日的固定动作", 2)
    add_table(doc, ["时点", "动作", "完成标准"], [
        ["开始工作时", "查看账号状态、平台警告、发布失败、链接失效、库存或履约异常", "风险先处理；异常账号暂停自动动作"],
        ["上午", "第一次检查评论、私信、表单、店铺和昨日未完成线索", "高意向先转人工；每条有负责人和下一步"],
        ["拍摄窗口", "按第9章采集当天最低素材包并上传命名", "素材、来源、授权和可用账号已标记"],
        ["目标市场活跃时段", "发布当日内容并做技术检查", "发布时间按目标时区分散测试；不套用通用最佳时间"],
        ["发布后服务窗口", "回答业务问题、修正事实错误、记录重复问题", "公开问题优先公开答；隐私和报价转私下"],
        ["结束工作前", "第二次检查收件箱；更新客户状态、内容数据和次日素材缺口", "无遗漏高意向；销售结果已回写或已催办"],
    ], [1850, 4760, 2700], first_bold=True, font_size=9.1)
    add_heading(doc, "11.2 每周运营循环", 2)
    add_table(doc, ["日", "运营动作", "只允许一个主要判断"], [
        ["周一", "锁定上周数据；区分目标客户反应和普通流量；选本周一个问题", "人群、开头、主题、证据或下一步中选1项"],
        ["周二", "从销售、客服、评论、站内搜索和官网搜索问题选题", "每题写清给谁看、回答什么、用什么证明、要做什么"],
        ["周三", "集中脚本、拍摄和初剪；补真实证据", "同一测试只改一个主要变量"],
        ["周四", "事实、权利、品牌、语言和入口检查；排期", "未通过内容不发布"],
        ["周五至周日", "滚动发布、回复、销售转交、补拍和技术修正", "不互赞互评，不购买数据，不群发骚扰"],
        ["下周一", "把内容—客户—销售/订单串起来复盘", "继续、重做、停止、扩号或并号择一"],
    ], [1400, 5040, 2870], first_bold=True, font_size=9.0)
    add_heading(doc, "11.3 评论和私信五类分流", 2)
    add_table(doc, ["类型", "怎么识别", "处理"], [
        ["普通互动", "表情、称赞、一般讨论", "自然回复；不强行推销"],
        ["产品或专业问题", "问功能、规格、用法、技术或适用性", "AI可起草，事实由人工核对后回复"],
        ["采购、合作或购买意向", "问价格、交期、样品、定制、经销、库存、购买", "优先人工；记录来源、需求、负责人和下一步"],
        ["投诉和高风险问题", "合同、价格争议、索赔、安全、法律、负面事件", "只转人工；不让AI自行承诺或删评"],
        ["垃圾与欺诈", "重复、诈骗、机器人、无关广告", "标记、屏蔽或举报；不计入有效结果"],
    ], [1900, 4160, 3250], first_bold=True, font_size=9.2)
    add_label_paragraph(doc, "【内部建议响应时限】", "明确商业意向在2个服务小时内转给人工；普通业务问题在1个工作日内回复；销售或客服在1个工作日内回写首次结果。若团队做不到，应减少发布量或活跃账号，而不是继续扩号。")
    add_heading(doc, "11.4 合格客户记录字段", 2)
    add_table(doc, ["客群", "必须记录"], [
        ["B2B采购", "姓名/角色、公司、国家与市场、产品、用途、规格/定制、数量、时间、来源账号与内容、下一步、负责人、日期"],
        ["渠道伙伴", "公司、地区、经营品类、渠道类型、客户群、仓储/服务/推广能力、合作产品、来源内容、下一步"],
        ["DTC客户", "产品/规格、用途、国家、购买异议、商品链接、订单号、投诉证据、希望解决方式、来源内容"],
    ], [2000, 7310], first_bold=True)
    add_heading(doc, "11.5 哪些动作一律禁止", 2)
    for item in [
        "矩阵账号按配额互相点赞、评论、关注或观看。",
        "购买粉丝、播放、收藏、评论、订阅或评论交换。",
        "批量自动注册账号、自动加人、自动群发、自动评论或重复私信。",
        "用虚假员工、客户、消费者或经销商身份发布内容。",
        "多个账号反复发布相同视频、相同文案和相同入口，只做微小改动。",
        "没有授权搬运客户、创作者、竞争对手、展会或音乐内容。",
    ]:
        add_bullet(doc, item)
    add_body(doc, "LinkedIn禁止虚假个人身份、共享个人账号和未经许可的自动化【P1—P5】；YouTube禁止虚假互动和垃圾内容【P11—P12】；TikTok禁止自动化批量账号、垃圾商业内容和假互动【P18】；Instagram与Facebook同样限制垃圾内容、重复骚扰、假互动和低价值搬运【P23、P26—P27】。")

    # 12 measurement and expansion
    add_heading(doc, "12 结果判断、扩号、并号与停号", 1, page_break=True)
    add_heading(doc, "12.1 不用播放量做唯一目标", 2)
    add_table(doc, ["层级", "看什么", "用途"], [
        ["内容是否被看到", "展示、播放、搜索词、来源、观看时间或留存", "判断选题、开头、表达和平台是否适配"],
        ["是否吸引对的人", "目标岗位/公司/地区的观看、评论、主页访问、收藏、分享", "区分目标客户与普通流量"],
        ["是否进入下一步", "有效私信、表单、商品点击、预约、样品、报价、加购、订单", "判断证据和入口是否有效"],
        ["是否产生业务价值", "销售确认机会、经销机会、净履约订单、净贡献毛利", "决定资源、扩号和长期经营"],
    ], [1950, 4610, 2750], first_bold=True, font_size=9.2)
    add_heading(doc, "12.2 各路线的最终结果", 2)
    add_table(doc, ["路线", "最终结果", "前置观察"], [
        ["B2B从零/已有基础", "滚动90天销售确认机会数【内部建议窗口】", "目标买家反应、有效询盘、会议/报价/样品/技术确认"],
        ["品牌影响力", "目标市场主动找、问或进入品牌资料的合格行为", "目标人群观看、品牌主页访问、品牌搜索、合格咨询；定义由客户确认"],
        ["渠道招商", "销售确认的合格渠道机会数", "伙伴申请、合作私信、会议、样品、地区和能力信息完整度"],
        ["DTC", "社媒归因净贡献毛利", "净履约订单、退款退货、可变成本、单净订单成本"],
        ["GEO", "固定问题集中正确品牌提及与引用覆盖", "引用来源是否正确、事实是否过期、是否带来访问；不能承诺被AI系统收录"],
    ], [1650, 4070, 3590], first_bold=True, font_size=9.1)
    add_heading(doc, "12.3 内容组合和复现", 2)
    add_label_paragraph(doc, "【内部建议】", "首轮平均分配问题、证据、场景和人物内容。出现可重复的有效路径后，用60%复现已验证栏目、25%测试相邻问题、15%探索新方向。复现是换真实问题、案例或证据，不是复制同一视频。")
    add_heading(doc, "12.4 扩号条件", 2)
    for item in [
        "新账号服务不同人群，且五个角色字段至少两项不同。",
        "主账号已有多个内容证明同一路径可重复，不依赖一条偶然高播放。",
        "新账号有至少4周独立内容库、真实负责人和独立回复能力【内部建议】。",
        "内容ID、客户ID、线索/订单ID可以独立对应。",
        "新增账号不会稀释主账号素材、审批和客服能力。",
        "每个4周观察窗口最多新增1个账号【内部建议】。",
    ]:
        add_bullet(doc, item)
    add_heading(doc, "12.5 合并或暂停条件", 2)
    add_table(doc, ["情况", "动作"], [
        ["两个账号面向同一人、内容和下一步高度相同", "合并回主号或转为主号栏目"],
        ["用户无法说明两个账号的区别", "重写角色卡；仍无区别则合并"],
        ["新号只重复主号成片，且没有新增客户", "停止复制；保留数据，暂停账号"],
        ["新号耗尽素材，导致主号断更或回复积压", "优先主号；立即降低新号频率"],
        ["账号归属、版权、隐私、商业披露、库存或履约异常", "立即暂停相关内容与自动动作，风险解决后再恢复"],
        ["连续两个有效观察窗口无独立价值，完成一次实质重定位仍无改善【内部建议】", "进入合并或停号评估；不删除历史数据"],
    ], [4790, 4520], first_bold=True, font_size=9.4)

    # 13 troubleshooting
    add_heading(doc, "13 目标未达成时的逐层排查", 1, page_break=True)
    add_body(doc, "从上到下排查。前一层没有成立，不要用下一层的数据做结论。例如内容没有稳定发布，就不能判断平台一定不适合。")
    add_table(doc, ["现象", "先查什么", "解决动作"], [
        ["内容发不出来", "素材、审批、权限、产能、账号数", "减少活跃账号和频次；建立两周素材库存【内部建议】；修好权限和审批"],
        ["发布了但几乎没人看到", "账号限制、选题、开头、语言、画面、目标客户是否在平台", "查账号状态；每次只改一项；用真实客户问题重做；两轮有效测试后再评估换平台"],
        ["有观看但不是目标客户", "人群定义、行业/场景、语言、标签、出镜角色、投放定向", "缩窄人群和问题；减少泛流量话题；把证据和入口写给目标角色"],
        ["目标客户看了但不行动", "答案是否有价值、证据是否可信、下一步是否清楚、链接是否可用", "增加真实演示、案例、限制说明；一条只放一个低门槛动作；真实测试入口"],
        ["有咨询但质量差", "内容是否过泛、是否缺资格条件、销售是否完整记录", "明确适合/不适合；内容中写国家、用途、规格、起订或合作条件；表单增加必要字段"],
        ["咨询合格但没有下一步", "首次响应、需求确认、销售能力、报价/样品流程", "高意向2个服务小时内转人工【内部建议】；设唯一负责人和截止时间；补销售异议内容"],
        ["有订单但利润差或退货高", "折扣、商品成本、履约、承诺、退款、售后", "暂停扩大流量；修正内容承诺、商品页、库存和售后；以净贡献毛利重算"],
        ["一个账号好、其他账号差", "角色是否独立、素材是否被稀释、承接是否重叠", "资源回到主号；差账号转栏目或暂停；不要为了矩阵数量硬保留"],
        ["单条爆了但不能复现", "是否偶然话题、普通流量、无业务下一步", "做2—3条同路径新内容【内部建议】；只改变一个变量；无重复目标信号则不扩号"],
        ["平台规则或功能变化", "官方帮助中心、账号后台、地区和权限", "暂停依赖该功能的自动化；更新本SOP版本；用客户当期后台字段重建比较"],
    ], [2140, 3490, 3680], first_bold=True, font_size=8.8)
    add_heading(doc, "提高成功概率的运营做法", 2)
    for item in [
        "一个主平台先跑通，再增加第二个平台。",
        "1—2个账号先跑通，再增加角色；账号数不是成绩。",
        "内容来自客户真实问题和真实证据，不靠泛热点填充。",
        "每天小批量拍，按周集中制作，让素材供给稳定。",
        "一条视频只解决一个问题、给一个下一步。",
        "发布后优先服务客户，而不是追求矩阵互相制造热度。",
        "把内容、客户、销售/订单结果串起来，用自己的数据调整。",
        "不承诺“发多少条一定成功”；承诺的是持续测试、可追踪、及时修正。",
    ]:
        add_bullet(doc, item)

    # 14 Templates
    add_heading(doc, "14 可直接复制的执行模板", 1, page_break=True)
    add_heading(doc, "14.1 客户路线确认表", 2)
    add_table(doc, ["问题", "填写"], [
        ["本轮唯一主目标", "□ B2B销售机会  □ 品牌需求  □ 渠道合作  □ DTC净利润  □ GEO正确提及"],
        ["目标人群", "国家/地区：____  公司或消费者类型：____  岗位/场景：____"],
        ["成交或合作下一步", "□ 会议  □ 报价  □ 样品  □ 技术确认  □ 伙伴评估  □ 下单"],
        ["候选平台", "LinkedIn / YouTube / TikTok / Instagram / Facebook"],
        ["主平台验证证据", "30个目标样本：____  20个同行样本：____  20个问题：____【内部建议】"],
        ["内容产能", "每周可拍摄人数：____  场地：____  产品/案例：____  可审核人：____"],
        ["承接能力", "评论/私信负责人：____  销售/客服负责人：____  工作时段：____"],
        ["数据回写", "账号ID—内容ID—客户/订单ID由谁维护：____"],
    ], [2650, 6660], first_bold=True, font_size=9.5)
    add_heading(doc, "14.2 账号角色卡", 2)
    add_table(doc, ["字段", "填写"], [
        ["账号名称与平台", "____________________________________________"],
        ["主要面向谁", "____________________________________________"],
        ["长期解决什么问题", "____________________________________________"],
        ["固定栏目", "1 ____  2 ____  3 ____"],
        ["谁表达", "____________________________________________"],
        ["证据从哪里来", "____________________________________________"],
        ["唯一下一步", "____________________________________________"],
        ["评论/私信承接人", "____________________________________________"],
        ["不讲什么", "____________________________________________"],
        ["与其他账号至少两项不同", "□ 人群  □ 问题  □ 人物  □ 证据  □ 下一步"],
    ], [3000, 6310], first_bold=True)
    add_heading(doc, "14.3 单条内容卡", 2)
    add_table(doc, ["字段", "填写"], [
        ["内容ID / 平台 / 账号", "____________________________________________"],
        ["给谁看", "____________________________________________"],
        ["只回答一个什么问题", "____________________________________________"],
        ["直接答案", "____________________________________________"],
        ["证据及来源编号", "____________________________________________"],
        ["适用与不适用", "____________________________________________"],
        ["唯一下一步", "____________________________________________"],
        ["人物/客户/音乐/素材授权", "____________________________________________"],
        ["事实审核人 / 日期", "____________________________________________"],
        ["发布URL / 平台内容ID", "____________________________________________"],
        ["24h / 72h / 7d结果【内部建议】", "____________________________________________"],
        ["客户与销售/订单结果", "____________________________________________"],
    ], [3000, 6310], first_bold=True)
    add_heading(doc, "14.4 每周复盘表", 2)
    add_table(doc, ["问题", "结论"], [
        ["本周是否按批准计划发布", "____________________________________________"],
        ["哪些内容吸引了目标人群", "____________________________________________"],
        ["哪些只是普通流量", "____________________________________________"],
        ["哪个问题反复出现", "____________________________________________"],
        ["哪种证据最有效", "____________________________________________"],
        ["哪个下一步最容易被执行", "____________________________________________"],
        ["产生了哪些客户、销售机会或订单", "____________________________________________"],
        ["哪个账号有独立价值", "____________________________________________"],
        ["是否有账号或内容重复", "____________________________________________"],
        ["下周唯一主要变量", "____________________________________________"],
        ["决定", "□ 保留  □ 重做  □ 停止  □ 扩号  □ 合并"],
    ], [3400, 5910], first_bold=True)

    # Sources
    add_heading(doc, "15 数据口径与官方来源", 1, page_break=True)
    add_heading(doc, "15.1 三类数字必须分开", 2)
    add_table(doc, ["标签", "含义", "怎么使用"], [
        ["【平台官方】", "平台帮助中心、条款或官方公告中能直接确认的功能、权限、政策和指标", "在本文件用P编号引用；上线前仍需检查账号所在地区和当期后台"],
        ["【内部建议】", "灵枢用于第一轮测试的账号数、频次、时长、窗口、内容比例和响应时限", "不是行业平均值或结果保证；必须按客户产能和自有数据更新"],
        ["【客户数据】", "客户账号后台、网站、表单、CRM、店铺、订单和财务结果", "是决定保留、扩号、并号、停号和预算的主要依据"],
    ], [1750, 4430, 3130], first_bold=True, font_size=9.3)
    add_body(doc, "不同平台对“播放、展示、观看、互动、点击”的定义不同，不能直接相加。YouTube可以查看内容、来源与留存数据【P7—P8】；LinkedIn个人内容和Page也有各自分析字段【P4a—P4b】；TikTok和Meta字段会随账号类型、地区和产品更新，应以客户当期后台导出为准。")
    add_heading(doc, "15.2 输入材料", 2)
    add_body(doc, "用户提供的《行业起航包-视频矩阵搭建.docx》作为现状草案和问题来源。本SOP重新组织了客户画像、账号角色、平台差异、发布节奏、每日素材、运营动作和失败处置；附件中的内容不被视为平台官方规则。", size=9.5)
    add_heading(doc, "15.3 官方来源", 2)
    sources = [
        ("P1", "LinkedIn 用户协议 真实姓名、一个个人账号、不得共享账号", "https://www.linkedin.com/legal/user-agreement"),
        ("P2", "LinkedIn Profile 与 Page 的区别", "https://www.linkedin.com/help/linkedin/answer/a6244797"),
        ("P3", "LinkedIn Page 消息规则", "https://www.linkedin.com/help/linkedin/answer/a1356464"),
        ("P4a", "LinkedIn 个人帖子分析", "https://www.linkedin.com/help/linkedin/answer/a516971"),
        ("P4b", "LinkedIn Page 内容分析", "https://www.linkedin.com/help/linkedin/answer/a564052"),
        ("P5", "LinkedIn 禁止未经许可的软件与自动化", "https://www.linkedin.com/help/linkedin/answer/a1341387"),
        ("P6", "YouTube 频道权限", "https://support.google.com/youtube/answer/9481328"),
        ("P7", "YouTube 内容表现与流量来源", "https://support.google.com/youtube/answer/12220281"),
        ("P8", "YouTube 观看留存", "https://support.google.com/youtube/answer/9314415"),
        ("P9", "YouTube 链接规则", "https://support.google.com/youtube/answer/13748639"),
        ("P10", "YouTube 全球频道与多语言频道策略", "https://support.google.com/youtube/answer/6070467"),
        ("P11", "YouTube 虚假互动政策", "https://support.google.com/youtube/answer/3399767"),
        ("P12", "YouTube 垃圾内容与误导政策", "https://support.google.com/youtube/answer/2801973"),
        ("P13", "TikTok Organization Accounts", "https://ads.tiktok.com/resources/help/article/about-organization-accounts?lang=en"),
        ("P14", "TikTok Business Center 账号管理", "https://ads.tiktok.com/resources/help/article/business-account-integration-with-business-center?lang=en"),
        ("P15", "TikTok 商业账号权限等级", "https://ads.tiktok.com/resources/help/article/about-tiktok-account-entitlements?lang=en"),
        ("P16", "TikTok 商业内容披露", "https://support.tiktok.com/en/business-and-creator/creator-and-business-accounts/promoting-a-brand-product-or-service"),
        ("P17", "TikTok 商业音乐使用", "https://support.tiktok.com/en/business-and-creator/creator-and-business-accounts/commercial-use-of-music-on-tiktok"),
        ("P18", "TikTok 真实性与完整性政策", "https://www.tiktok.com/community-guidelines/en/integrity-authenticity/"),
        ("P19", "Meta Facebook 与 Instagram 推荐使用多类信号", "https://about.fb.com/news/2023/06/how-ai-ranks-content-on-facebook-and-instagram/"),
        ("P20", "Instagram Reels 观看时间数据", "https://about.fb.com/news/2023/04/instagram-reels-trending-audio-and-gifts-updates/"),
        ("P21", "Instagram 商业音乐规则", "https://www.facebook.com/help/instagram/402084904469945"),
        ("P22", "Instagram 品牌合作披露", "https://www.facebook.com/help/instagram/616901995832907"),
        ("P23", "Instagram 社区准则", "https://www.facebook.com/help/477434105621119"),
        ("P24", "Facebook Page 访问权限", "https://www.facebook.com/help/289207354498410/"),
        ("P25", "Facebook 视频逐步统一为 Reels", "https://about.fb.com/news/2025/06/making-it-easier-create-videos-facebook/"),
        ("P26", "Facebook 反垃圾内容说明", "https://about.fb.com/news/2025/04/cracking-down-spammy-content-facebook/"),
        ("P27", "Facebook 原创内容规则", "https://about.fb.com/news/2026/03/rewarding-original-creators-on-facebook/"),
    ]
    for code, title, url in sources:
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(4)
        p.paragraph_format.line_spacing = 1.15
        r = p.add_run(f"{code}  {title}  ")
        set_run(r, size=9.2, bold=True, color=BLACK)
        add_hyperlink(p, "打开官方页面", url)
    add_body(doc, f"来源核对日期：{TODAY.isoformat()}。平台规则会更新；每次大规模启用新账号、使用新商业功能或变更自动化前，应重新核对相关官方页面。", size=9.3, color=GRAY)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save(OUTPUT)
    print(OUTPUT)


if __name__ == "__main__":
    build()
