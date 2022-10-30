const { expect } = require("chai");
const { ethers } = require("hardhat");
const { formatUnits, parseUnits } = require("ethers/lib/utils");
const helpers = require("@nomicfoundation/hardhat-network-helpers");
const { deployPriceOracle, deployComptroller, deployUnitroller, deployCTokens, deployInterestRateModels, deployErc20Token } = require("./Utils/deploy");
const { INTEREST_RATE_MODEL } = require("../config");


describe("AppWorks contract", function () {
  let owner, accountA, accountB, otheraccounts;
  let undA, undB, unitrollerProxy, cErc20A,
    cErc20B, priceOracle, whitePaperInterestRateModel,
    ctokenArgs, signerA, signerB;

  before(async function () {
    [owner, accountA, accountB, ...otheraccounts] = await ethers.getSigners();
    signerA = await ethers.getSigner(accountA.address);
    signerB = await ethers.getSigner(accountB.address);
    /* ------------------------------------------------------ */
    /*                 priceOracle module                     */
    /* ------------------------------------------------------ */
    priceOracle = await deployPriceOracle();
    console.log("\n✅ Deploy SimplePriceOracle to: ", priceOracle.address);

    /* ------------------------------------------------------ */
    /*                   comptroller module                   */
    /* ------------------------------------------------------ */
    const unitroller = await deployUnitroller();
    console.log("\n✅ Deploy Unitroller to: ", unitroller.address);

    const comptroller = await deployComptroller();
    console.log("\n✅ Deploy Comptroller to: ", comptroller.address);

    /* ---------------------- Set Proxy --------------------- */
    // @dev unitroller is proxy of comptroller module
    await unitroller._setPendingImplementation(comptroller.address);
    await comptroller._become(unitroller.address);

    /* ----- Call Comptroller Use Proxy --------------------- */
    unitrollerProxy = await ethers.getContractAt(
      "Comptroller",
      unitroller.address
    );

    await unitrollerProxy._setPriceOracle(priceOracle.address);

    // await unitrollerProxy._setCloseFactor(parseUnits("0.5", 18).toString());
    // ?
    // await unitrollerProxy._setMaxAssets(20);
    // await unitrollerProxy._setLiquidationIncentive(parseUnits("1.08", 18));

    /* ------------------------------------------------------ */
    /*                   interestRate module                  */
    /* ------------------------------------------------------ */
    whitePaperInterestRateModel = await deployInterestRateModels(
      0,0
      // INTEREST_RATE_MODEL.Base200bps_Slope3000bps.args.baseRatePerYear,
      // INTEREST_RATE_MODEL.Base200bps_Slope3000bps.args.multiplierPerYear
    );
    console.log(
      "\n✅ Deploy WhitePaperInterestRateModel to: ",
      whitePaperInterestRateModel.address
    );
    /* ------------------------------------------------------ */
    /*                   cToken module                        */
    /* ------------------------------------------------------ */

    undA = await deployErc20Token({
      supply: 10000000,
      name: "Under",
      symbol: "UND"
    });
    console.log("\n✅ Deploy UnderLyingToken to: ", undA.address);

    /* ------------------- deploy token b ------------------- */
    undB = await deployErc20Token({
      supply: 10000000,
      name: "UnderB",
      symbol: "UNDB"
    });
    console.log("\n✅ Deploy UnderLyingToken2 to: ", undB.address);

    ctokenArgs = [
      {
        name: "UnderA",
        symbol: "UNDA",
        underlying: undA.address,
        underlyingPrice: parseUnits('1', 18),
        collateralFactor: parseUnits('0.5', 18), // 50%
        // reserveFactor: parseUnits('5', 18), // 50%
      },
      {
        name: "UnderB",
        symbol: "UNDB",
        underlying: undB.address,
        underlyingPrice: parseUnits('100', 18),
        collateralFactor: parseUnits('0.5', 18), // 50%
        // reserveFactor: parseUnits('5', 18), // 50%
      },
    ];

    [cErc20A, cErc20B] = await deployCTokens(
      ctokenArgs,
      whitePaperInterestRateModel,
      priceOracle,
      unitrollerProxy,
      owner
    );
    await unitrollerProxy.connect(signerA).enterMarkets([cErc20A.address, cErc20B.address]);
    await unitrollerProxy.connect(signerB).enterMarkets([cErc20A.address, cErc20B.address]);
    snapshot = await helpers.takeSnapshot();
  });

  afterEach(async function () {
    // after doing some changes, you can restore to the state of the snapshot
    await snapshot.restore();
  });

  it('Check user markets', async function () {
    const enteredMarketsA = await unitrollerProxy.getAssetsIn(signerA.address)
    const enteredMarketsB = await unitrollerProxy.getAssetsIn(signerB.address)
    expect(enteredMarketsA.length).to.equal(2);
    expect(enteredMarketsA[0]).to.equal(cErc20A.address);
    expect(enteredMarketsA[1]).to.equal(cErc20B.address);
    expect(enteredMarketsB.length).to.equal(2);
    expect(enteredMarketsA[0]).to.equal(cErc20A.address);
    expect(enteredMarketsA[1]).to.equal(cErc20B.address);
  });
    
  it ('Check Price Oracle', async function () {
    expect(await priceOracle.getUnderlyingPrice(cErc20A.address)).to.equal(ctokenArgs[0].underlyingPrice);
    expect(await priceOracle.assetPrices(undA.address)).to.equal(ctokenArgs[0].underlyingPrice);
    expect(await priceOracle.getUnderlyingPrice(cErc20B.address)).to.equal(ctokenArgs[1].underlyingPrice);
    expect(await priceOracle.assetPrices(undB.address)).to.equal(ctokenArgs[1].underlyingPrice);
  });


  it('Check collateral factor', async function () {
    const marketA = await unitrollerProxy.markets(cErc20A.address);
    const marketB = await unitrollerProxy.markets(cErc20B.address);
    expect(marketA.collateralFactorMantissa).to.equal(ctokenArgs[0].collateralFactor);
    expect(marketB.collateralFactorMantissa).to.equal(ctokenArgs[1].collateralFactor);
  });
  
  it("Should be able to mint then redeem", async function () {
    /* ------------------------ mint ------------------------ */
    await undA.transfer(signerA.address, parseUnits("100", 18));
    expect(await undA.balanceOf(signerA.address)).to.equal(parseUnits("100", 18));
    await undA.connect(signerA).approve(cErc20A.address, parseUnits("100", 18));
    await cErc20A.connect(signerA).mint(parseUnits("100", 18));
    expect(await undA.balanceOf(signerA.address)).to.equal(0);
    expect(await cErc20A.balanceOf(signerA.address)).to.equal(parseUnits("100", 18));
    expect(await cErc20A.totalSupply()).to.equal(parseUnits("100", 18));
    expect(await cErc20A.getCash()).to.equal(parseUnits("100", 18));
    /* ----------------------- redeem ----------------------- */
    await cErc20A.connect(signerA).redeem(parseUnits("100", 18));
    expect(await undA.balanceOf(signerA.address)).to.equal(parseUnits("100", 18));
    expect(await cErc20A.balanceOf(signerA.address)).to.equal(0);
    expect(await cErc20A.totalSupply()).to.equal(0);
    expect(await cErc20A.getCash()).to.equal(0);

    expect(await cErc20A.supplyRatePerBlock()).to.equal(0);
  });

  it("Should be able to borrow then repay", async function () {
    /* ------------------------ mint a------------------------ */
    await undA.transfer(signerA.address, parseUnits("100", 18));
    expect(await undA.balanceOf(signerA.address)).to.equal(parseUnits("100", 18));
    await undA.connect(signerA).approve(cErc20A.address, parseUnits("100", 18));
    await cErc20A.connect(signerA).mint(parseUnits("100", 18));
    expect(await undA.balanceOf(signerA.address)).to.equal(0);
    expect(await cErc20A.balanceOf(signerA.address)).to.equal(parseUnits("100", 18));
    expect(await cErc20A.totalSupply()).to.equal(parseUnits("100", 18));
    expect(await cErc20A.getCash()).to.equal(parseUnits("100", 18));
    /* -------------------- mint token b -------------------- */
    await undB.transfer(signerB.address, parseUnits("1", 18));
    await undB.connect(signerB).approve(cErc20B.address, parseUnits("1", 18));
    await cErc20B.connect(signerB).mint(parseUnits("1", 18));
    expect(await undB.balanceOf(signerB.address)).to.equal(0);
    expect(await cErc20B.balanceOf(signerB.address)).to.equal(parseUnits("1", 18));
    expect(await cErc20B.totalSupply()).to.equal(parseUnits("1", 18));
    expect(await cErc20B.getCash()).to.equal(parseUnits("1", 18));
    const liquidity = await unitrollerProxy.getAccountLiquidity(signerB.address);
    /* ----------------------- borrow ----------------------- */
    const borrowAmount = parseUnits("50", 18);
    expect(await await cErc20A.supplyRatePerBlock()).to.equal(0);
    await cErc20A.connect(signerB).borrow(borrowAmount);
    expect(await cErc20A.totalBorrows()).to.equal(borrowAmount);
    
  });
});