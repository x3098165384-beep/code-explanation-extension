<!-- code-explanation
{
  "version": 1,
  "id": "price-calculation-example",
  "sources": {
    "checkout-current": {
      "kind": "workspace",
      "path": "src/Checkout.cs",
      "exists": true,
      "sha256": "0b4109f697e2fba9e224f23dbe53f043ee307e1c6b880e797faa30ee17f35ed8"
    },
    "price-before": {
      "kind": "git",
      "path": "src/PriceCalculator.cs",
      "exists": true,
      "commit": "0232f869087a44271e3324ddee8e6fc81ea47079",
      "sha256": "6b906c637aa2904f45eea11234138fa1c73a45fc8ad2eba45521e33a8248b4f9"
    },
    "price-after": {
      "kind": "git",
      "path": "src/PriceCalculator.cs",
      "exists": true,
      "commit": "d02487f6e521d60b6b9fbc38bf8adc02036d4880",
      "sha256": "bd87366a3728b7cee619825b5cdadc0ae930e8147a707b5cfc6e8cac245c3627"
    },
    "price-current": {
      "kind": "workspace",
      "path": "src/PriceCalculator.cs",
      "exists": true,
      "sha256": "a3cee9017d43a8e71d375ece67e6876507257993a86fede1603619c47af8d05c"
    }
  }
}
-->
# 价格计算的调用与修改

这份讲解先看调用方，再看一次已提交的修改，最后看当前尚未提交的条件修改。它用于检查文件格式和阅读行为，对应独立的演示工程；代码与版本背景见[示例说明](example-context.md)。这里没有保存完整源码副本。

<!-- step
{
  "id": "checkout-call",
  "kind": "file",
  "source": "checkout-current",
  "target": {
    "startLine": 5,
    "endLine": 5,
    "sha256": "9cb2afe4fa6ff5546683ad9dc30585b7f52768b25abd0635426964c04652cf19"
  }
}
-->
## 调用方把单价和数量交给价格计算方法

`PriceCalculator` 是负责计算价格的类，`GetPrice` 是它提供的计算方法。括号里的 `price` 是这次传入的单价，`quantity` 是数量。

`PriceCalculator.GetPrice(price, quantity)` 先调用计算方法，得到一个整数结果。前面的 `return` 再把这个结果交给调用 `GetTotal` 的代码。这里没有自己再计算一次价格，而是使用 `GetPrice` 的返回值。

<!-- step
{
  "id": "committed-guard",
  "kind": "diff",
  "comparison": "commits",
  "left": "price-before",
  "right": "price-after",
  "targets": {
    "left": {
      "startLine": 5,
      "endLine": 5,
      "sha256": "1ea841936cc7e07069e1a8c4ad2d9df36b294f764bf5e7beb935993bec41d4f8"
    },
    "right": {
      "startLine": 5,
      "endLine": 8,
      "sha256": "1366e261d14696252961e8631796fe3123732a0b3a1fd26a9537f0884bf4abe3"
    }
  }
}
-->
## 数量不大于零时，先返回零

改前的 `return price * quantity;` 会直接把单价乘以数量，再返回乘积。数量为负数时，只要单价为正，也会算出一个负的价格。

改后的 `quantity <= 0` 表示“数量小于或等于零”。条件成立时，进入花括号内执行 `return 0;`：返回零，并立即结束这次 `GetPrice` 调用，后面的乘法不会再执行。

数量大于零时，这个条件不成立，跳过这段提前返回的代码，再执行后面的价格计算。这次修改先处理无效数量，避免继续按负数量计算价格。

<!-- step
{
  "id": "removed-direct-return",
  "kind": "diff",
  "comparison": "commits",
  "left": "price-before",
  "right": "price-after",
  "targets": {
    "left": {
      "startLine": 5,
      "endLine": 5,
      "sha256": "1ea841936cc7e07069e1a8c4ad2d9df36b294f764bf5e7beb935993bec41d4f8"
    }
  }
}
-->
## 改前这条直接返回乘积的语句被移除

这一行里的 `price * quantity` 是单价乘以数量，`return` 把乘积作为方法结果返回。

这条写法在本次 diff 的改前侧显示为删除。它不代表改后不再做乘法，而是改后先判断数量，再把计算和返回拆成下面两条语句。这里单独停在删除行，是为了看清原来的执行方式。

<!-- step
{
  "id": "added-total-variable",
  "kind": "diff",
  "comparison": "commits",
  "left": "price-before",
  "right": "price-after",
  "targets": {
    "right": {
      "startLine": 10,
      "endLine": 11,
      "sha256": "0b2271da65d81bb46f051ac1e549c1b0c298bd8ab78a8236545b5b3270468be9"
    }
  }
}
-->
## 改后先保存计算结果，再返回

`int total` 声明一个名为 `total` 的整数变量。等号右侧的 `price * quantity` 先计算乘积，再把结果赋给 `total`。

下一行 `return total;` 把刚才保存的结果返回给调用方，并结束方法。正常数量下，这两行仍然返回单价与数量的乘积；数量无效时，前面的 `return 0;` 已经结束调用，不会走到这里。

<!-- step
{
  "id": "current-price-guard",
  "kind": "diff",
  "comparison": "working-tree",
  "left": "price-after",
  "right": "price-current",
  "targets": {
    "left": {
      "startLine": 5,
      "endLine": 5,
      "sha256": "c47985c128b2f526572f0d411db8d51af0941ab93b83ee63766cd9770f463e0f"
    },
    "right": {
      "startLine": 5,
      "endLine": 5,
      "sha256": "bf29e60ffa2aa836dba28c5ac41e8b95287fab4e6b1890d68c26e4f7305e1a59"
    }
  }
}
-->
## 当前未提交的修改又排除了负单价

最近一次提交只判断 `quantity <= 0`，也就是数量是否小于或等于零。

当前编辑内容把条件改为 `quantity <= 0 || price < 0`。`price` 是单价，`price < 0` 表示单价为负数；`||` 表示两项条件只要有一项成立，整个条件就成立。

执行时先判断数量。如果数量已经不大于零，整个条件就成立，不必再判断右边；数量大于零时，才继续判断单价是否为负。任一条件成立，都会进入已有的 `return 0;`。单价等于零没有被这个新条件排除，仍按后面的乘法得到零。

这一步比较的是最近一次提交和当前编辑内容。继续修改代码后，只有对应检查仍能确认这些条件文本时，旧讲解才能继续显示在代码旁。
