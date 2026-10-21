# 完整讲解示例的代码与版本背景

配合[完整 Markdown 讲解文件](explanation.example.md)和[文件格式](explanation-format.md)阅读。这里展示的是独立演示工程的资料，不是插件实现，也不是要求真实讲解另存源码。实际讲解只引用用户项目中已有的代码与 Git 版本。

## 示例包含什么

| 步骤标识 | 类型 | 验证用途 |
| --- | --- | --- |
| `checkout-call` | 普通脚本 | 当前文件的第 5 行调用 |
| `committed-guard` | 两个提交的 diff | 同一步指出改前第 5 行和改后第 5 至 8 行 |
| `removed-direct-return` | 两个提交的 diff | 删除行只在改前侧定位，但保留完整 diff |
| `added-total-variable` | 两个提交的 diff | 新增行只在改后侧定位 |
| `current-price-guard` | 未提交修改的 diff | 最近一次提交与当前第 5 行条件的比较 |

本次文档整理曾在临时的独立 Git 工程中生成并核对这两个真实提交。它们不属于插件项目的历史。示例不能直接在插件项目根目录下定位这些代码；需要配套演示工程，或为实际用户项目重新生成引用。

## 两次提交

| 内容 | 完整提交标识 |
| --- | --- |
| 最初直接计算价格 | `0232f869087a44271e3324ddee8e6fc81ea47079` |
| 增加数量判断及结果变量 | `d02487f6e521d60b6b9fbc38bf8adc02036d4880` |

演示工程的 HEAD 停留在第二次提交。随后只在当前文件中增加负单价判断，不提交这次修改。真实项目中的提交标识由真实历史决定；不能为套用示例而伪造提交或切换用户分支。

如需在独立目录复现同样的演示提交，先初始化空仓库并创建下文的两个文件。第一次暂存并提交调用方和第一版价格计算，再只提交第二版价格计算；最后写入当前版本而不提交。两次提交均使用作者和提交者名称 `XGH`、邮箱 `xgh@example.com`，该邮箱仅用于演示，不是联系地址。第一次提交的作者及提交者时间均为 `2026-10-21T12:00:00+08:00`，提交说明为“示例：直接计算价格”；第二次均为 `2026-10-21T12:01:00+08:00`，说明为“示例：数量无效时返回零”。只暂存这两个文件，使用本文精确文本、普通文件权限、LF 换行、末尾一个 LF，并关闭提交签名。作者、时间、文本或提交说明改变都会改变提交标识，此时必须用实际生成的提交和摘要更新讲解示例。

## 始终不变的调用方

文件 `src/Checkout.cs`，第 5 行是目标。文本使用 LF 换行，末尾有一个 LF。

```csharp
public static class Checkout
{
    public static int GetTotal(int price, int quantity)
    {
        return PriceCalculator.GetPrice(price, quantity);
    }
}
```

## 第一次提交的价格计算

文件 `src/PriceCalculator.cs`，第 5 行是原来的返回语句。文本使用 LF 换行，末尾有一个 LF。

```csharp
public static class PriceCalculator
{
    public static int GetPrice(int price, int quantity)
    {
        return price * quantity;
    }
}
```

## 第二次提交的价格计算

同一文件，第 5 至 8 行增加数量判断，第 10 至 11 行计算并返回结果。文本使用 LF 换行，末尾有一个 LF。

```csharp
public static class PriceCalculator
{
    public static int GetPrice(int price, int quantity)
    {
        if (quantity <= 0)
        {
            return 0;
        }

        int total = price * quantity;
        return total;
    }
}
```

## 当前尚未提交的价格计算

同一文件，只改变第 5 行条件。文本使用 LF 换行，末尾有一个 LF。

```csharp
public static class PriceCalculator
{
    public static int GetPrice(int price, int quantity)
    {
        if (quantity <= 0 || price < 0)
        {
            return 0;
        }

        int total = price * quantity;
        return total;
    }
}
```

## 摘要核对

| 完整文件内容 | SHA-256 文本摘要 |
| --- | --- |
| 调用方 | `0b4109f697e2fba9e224f23dbe53f043ee307e1c6b880e797faa30ee17f35ed8` |
| 第一次提交的价格计算 | `6b906c637aa2904f45eea11234138fa1c73a45fc8ad2eba45521e33a8248b4f9` |
| 第二次提交的价格计算 | `bd87366a3728b7cee619825b5cdadc0ae930e8147a707b5cfc6e8cac245c3627` |
| 当前尚未提交的价格计算 | `a3cee9017d43a8e71d375ece67e6876507257993a86fede1603619c47af8d05c` |

范围摘要也已按文件格式规定的方法计算；目标范围不额外添加结束换行。每次为不同项目或修改后的代码生成讲解，都需要重新读取并计算，不能只把示例里的文件名改掉。

## 已核对与未验证的边界

本次核对包括：示例备注中的 JSON 可读取、文件与步骤标识及引用一致、提交真实存在、文件及目标行范围的摘要正确、最后一步左侧等于演示工程 HEAD，以及删除行和新增行确实出现在这次 Git diff 中。

这不代表已经实现讲解读取器，也不代表 VS Code 中的原生行内显示、diff 两侧定位、自动更新和进度恢复已通过。实施后仍须逐项执行规格中的运行验收。
